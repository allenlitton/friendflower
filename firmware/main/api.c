// Talks to friendflower.app over HTTPS.
//
// The device makes up a secret once (kept in NVS). Unlinked, it asks
// /api/device/pair for a short code, shows it, and checks
// /api/device/pair/status until the member types it in at
// friendflower.app/device. Linked, it fetches /api/device/summary every
// minute with the secret as its key. If that says 401 (removed from the
// site), it forgets it was linked and shows a new code.
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "api.h"
#include "net.h"

static const char *TAG = "api";
#define BASE "https://friendflower.app"
#define REFRESH_MS 60000
#define POLL_MS 3000
#define KICK_AFTER 3 // failed requests in a row before rejoining Wi-Fi

static api_cb_t s_cb;
static char s_secret[65];
static volatile bool s_refresh_now;
static int s_failures;

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

typedef struct { char *buf; int len, cap; } body_t;

static esp_err_t on_data(esp_http_client_event_t *e) {
  body_t *b = e->user_data;
  if (e->event_id == HTTP_EVENT_ON_DATA && b) {
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

// One request. Returns the HTTP status (or -1) and the parsed JSON body in *out.
static int request(const char *path, const char *post_body, bool with_key, cJSON **out) {
  char url[128];
  snprintf(url, sizeof url, BASE "%s", path);
  body_t b = { 0 };
  esp_http_client_config_t cfg = {
    .url = url, .method = post_body ? HTTP_METHOD_POST : HTTP_METHOD_GET, .timeout_ms = 15000,
    .crt_bundle_attach = esp_crt_bundle_attach, .event_handler = on_data, .user_data = &b,
    .buffer_size = 2048, .buffer_size_tx = 1024,
  };
  esp_http_client_handle_t c = esp_http_client_init(&cfg);
  char auth[80];
  if (with_key) { snprintf(auth, sizeof auth, "Bearer %s", s_secret); esp_http_client_set_header(c, "Authorization", auth); }
  if (post_body) {
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_post_field(c, post_body, strlen(post_body));
  }
  int status = esp_http_client_perform(c) == ESP_OK ? esp_http_client_get_status_code(c) : -1;
  esp_http_client_cleanup(c);
  *out = b.buf ? cJSON_Parse(b.buf) : NULL;
  free(b.buf);
  if (status < 0) {
    ESP_LOGW(TAG, "%s failed", path);
    if (++s_failures >= KICK_AFTER) { s_failures = 0; net_kick(); }
  } else s_failures = 0;
  return status;
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
  xTaskCreatePinnedToCore(api_task, "api", 10240, NULL, 4, NULL, 0);
}
