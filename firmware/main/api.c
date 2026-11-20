// Talks to friendflower.app over HTTPS.
//
// The device makes up a secret once (kept in NVS). Unlinked, it asks
// /api/device/pair for a short code, shows it, and checks
// /api/device/pair/status until the member types it in at
// friendflower.app/device. Linked, it fetches /api/device/summary every
// minute with the secret as its key. If that says 401 (removed from the
// site), it forgets it was linked and shows a new code.
//
// Everything else (photos, the map, chats, Fo) runs one job at a time on a
// second task, so a slow Fo reply never holds up the summary.
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "api.h"
#include "net.h"

static const char *TAG = "api";
#ifndef FF_API_BASE
#define FF_API_BASE "https://friendflower.app"  // idf.py build -DFF_API_BASE=http://<mac>:3000 to test locally
#endif
#define REFRESH_MS 60000
#define POLL_MS 3000
#define KICK_AFTER 3 // failed requests in a row before rejoining Wi-Fi

static api_cb_t s_cb;
static char s_secret[65];
static volatile bool s_refresh_now;
static int s_failures;
static QueueHandle_t s_jobs;

static void load_secret(void) {
  nvs_handle_t h;
  size_t len = sizeof s_secret;
  if (nvs_open("ff", NVS_READWRITE, &h) != ESP_OK) return;
  if (nvs_get_str(h, "secret", s_secret, &len) != ESP_OK || strlen(s_secret) != 64) {
    uint8_t raw[32];
    esp_fill_random(raw, sizeof raw);
    for (int i = 0; i < 32; i++) sprintf(s_secret + i * 2, "%02x", raw[i]);
    nvs_set_str(h, "secret", s_secret);
    nvs_commit(h);
  }
  nvs_close(h);
}

static bool linked_flag(int set) { // set: -1 read, 0 clear, 1 set
  nvs_handle_t h;
  uint8_t v = 0;
  if (nvs_open("ff", NVS_READWRITE, &h) != ESP_OK) return false;
  if (set >= 0) { nvs_set_u8(h, "linked", set); nvs_commit(h); v = set; }
  else nvs_get_u8(h, "linked", &v);
  nvs_close(h);
  return v;
}

void api_unlink(void) {
  linked_flag(0);
  nvs_handle_t h;
  if (nvs_open("ff", NVS_READWRITE, &h) == ESP_OK) { nvs_erase_key(h, "secret"); nvs_commit(h); nvs_close(h); }
}

void api_refresh(void) { s_refresh_now = true; }

static esp_err_t on_event(esp_http_client_event_t *e) {
  api_body_t *b = e->user_data;
  if (!b) return ESP_OK;
  if (e->event_id == HTTP_EVENT_ON_HEADER && b->header && !strcasecmp(e->header_key, b->header)) {
    snprintf(b->header_value, sizeof b->header_value, "%s", e->header_value);
  } else if (e->event_id == HTTP_EVENT_ON_DATA) {
    if (b->len + e->data_len + 1 > b->cap) {
      int cap = (b->len + e->data_len + 1) * 2;
      char *nb = realloc(b->buf, cap);
      if (!nb) return ESP_FAIL;
      b->buf = nb; b->cap = cap;
    }
    memcpy(b->buf + b->len, e->data, e->data_len);
    b->len += e->data_len;
    b->buf[b->len] = 0;
  }
  return ESP_OK;
}

static int http(const char *method, const char *path, const char *type, const void *body, int body_len,
                int timeout_ms, bool with_key, api_body_t *out) {
  char url[256];
  snprintf(url, sizeof url, FF_API_BASE "%s", path);
  esp_http_client_config_t cfg = {
    .url = url, .method = strcmp(method, "POST") ? HTTP_METHOD_GET : HTTP_METHOD_POST, .timeout_ms = timeout_ms,
    .crt_bundle_attach = strncmp(url, "https:", 6) ? NULL : esp_crt_bundle_attach,
    .event_handler = on_event, .user_data = out, .buffer_size = 4096, .buffer_size_tx = 1024,
  };
  esp_http_client_handle_t c = esp_http_client_init(&cfg);
  char auth[80];
  if (with_key) { snprintf(auth, sizeof auth, "Bearer %s", s_secret); esp_http_client_set_header(c, "Authorization", auth); }
  if (body) {
    esp_http_client_set_header(c, "Content-Type", type);
    esp_http_client_set_post_field(c, body, body_len);
  }
  int status = esp_http_client_perform(c) == ESP_OK ? esp_http_client_get_status_code(c) : -1;
  esp_http_client_cleanup(c);
  if (status < 0) {
    ESP_LOGW(TAG, "%s failed", path);
    if (++s_failures >= KICK_AFTER) { s_failures = 0; net_kick(); }
  } else s_failures = 0;
  return status;
}

int api_http(const char *method, const char *path, const char *type, const void *body, int body_len,
             int timeout_ms, api_body_t *out) {
  return http(method, path, type, body, body_len, timeout_ms, true, out);
}

void api_body_free(api_body_t *b) { free(b->buf); b->buf = NULL; b->len = b->cap = 0; }

static int json(const char *method, const char *path, const char *json_body, int timeout_ms, bool with_key, cJSON **out) {
  api_body_t b = { 0 };
  int status = http(method, path, "application/json", json_body, json_body ? strlen(json_body) : 0, timeout_ms, with_key, &b);
  *out = b.buf ? cJSON_Parse(b.buf) : NULL;
  api_body_free(&b);
  return status;
}

int api_json(const char *method, const char *path, const char *json_body, int timeout_ms, cJSON **out) {
  return json(method, path, json_body, timeout_ms, true, out);
}

// One request. Returns the HTTP status (or -1) and the parsed JSON body in *out.
static int request(const char *path, const char *post_body, bool with_key, cJSON **out) {
  return json(post_body ? "POST" : "GET", path, post_body, 15000, with_key, out);
}

typedef struct { void (*fn)(void *); void *arg; } job_t;

static void job_task(void *arg) {
  job_t j;
  for (;;) if (xQueueReceive(s_jobs, &j, portMAX_DELAY)) {
    while (!net_online()) vTaskDelay(pdMS_TO_TICKS(1000));
    j.fn(j.arg);
  }
}

bool api_job(void (*fn)(void *), void *arg) {
  job_t j = { fn, arg };
  return s_jobs && xQueueSend(s_jobs, &j, 0) == pdTRUE;
}

static void pair_until_linked(void) {
  char body[96];
  snprintf(body, sizeof body, "{\"secret\":\"%s\"}", s_secret);
  while (true) {
    while (!net_online()) vTaskDelay(pdMS_TO_TICKS(1000));
    cJSON *j = NULL;
    int st = request("/api/device/pair", body, false, &j);
    const cJSON *code = cJSON_GetObjectItem(j, "code");
    if (st != 200 || !cJSON_IsString(code)) {
      cJSON_Delete(j);
      s_cb(API_OFFLINE, NULL);
      vTaskDelay(pdMS_TO_TICKS(10000));
      continue;
    }
    s_cb(API_CODE, code->valuestring);
    cJSON_Delete(j);
    for (;;) {
      vTaskDelay(pdMS_TO_TICKS(POLL_MS));
      st = request("/api/device/pair/status", body, false, &j);
      bool linked = cJSON_IsTrue(cJSON_GetObjectItem(j, "linked"));
      bool expired = cJSON_IsTrue(cJSON_GetObjectItem(j, "expired"));
      cJSON_Delete(j);
      if (linked) { linked_flag(1); return; }
      if (expired) break; // get a fresh code
    }
  }
}

static void api_task(void *arg) {
  load_secret();
  for (;;) {
    if (!linked_flag(-1)) pair_until_linked();
    s_cb(API_LINKED, NULL);
    while (linked_flag(-1)) {
      while (!net_online()) vTaskDelay(pdMS_TO_TICKS(1000));
      cJSON *j = NULL;
      int st = request("/api/device/summary", NULL, true, &j);
      if (st == 200 && j) s_cb(API_SUMMARY, j);   // the UI takes ownership of j
      else {
        cJSON_Delete(j);
        if (st == 401) { linked_flag(0); s_cb(API_UNLINKED, NULL); break; }
        s_cb(API_OFFLINE, NULL);
      }
      for (int t = 0; t < REFRESH_MS / 250 && !s_refresh_now; t++) vTaskDelay(pdMS_TO_TICKS(250));
      s_refresh_now = false;
    }
  }
}

void api_start(api_cb_t cb) {
  s_cb = cb;
  s_jobs = xQueueCreate(24, sizeof(job_t));
  xTaskCreatePinnedToCore(api_task, "api", 10240, NULL, 4, NULL, 0);
  xTaskCreatePinnedToCore(job_task, "api_jobs", 10240, NULL, 4, NULL, 0);
}
