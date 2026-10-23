// Wi-Fi for the Friend Flower device.
//
// With no saved network it opens an open hotspot, "Friend Flower Setup". Phones
// that join get a sign-in page (the DNS below answers every name with the
// device, so the phone's captive-portal check lands on our page) where they
// pick their home network and type its password. That's saved in NVS and the
// device joins it. If the password is wrong it goes back to the hotspot.
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "lwip/sockets.h"
#include "nvs.h"
#include "net.h"

static const char *TAG = "net";
#define SETUP_SSID "Friend Flower Setup"
#define JOIN_TIMEOUT_MS 30000

static EventGroupHandle_t s_events;
#define GOT_IP BIT0
#define JOIN_FAILED BIT1

static net_state_cb_t s_cb;
static httpd_handle_t s_http;
static TaskHandle_t s_dns;
static esp_netif_t *s_sta, *s_ap;
static int s_retries;
static bool s_joining;

static void tell(net_state_t st, const char *detail) { if (s_cb) s_cb(st, detail); }

// ---- saved network ---------------------------------------------------------

static bool load_creds(char *ssid, size_t ssid_len, char *pass, size_t pass_len) {
  nvs_handle_t h;
  if (nvs_open("wifi", NVS_READONLY, &h) != ESP_OK) return false;
  bool ok = nvs_get_str(h, "ssid", ssid, &ssid_len) == ESP_OK;
  if (ok && nvs_get_str(h, "pass", pass, &pass_len) != ESP_OK) pass[0] = 0;
  nvs_close(h);
  return ok && ssid[0];
}

static void save_creds(const char *ssid, const char *pass) {
  nvs_handle_t h;
  if (nvs_open("wifi", NVS_READWRITE, &h) != ESP_OK) return;
  nvs_set_str(h, "ssid", ssid);
  nvs_set_str(h, "pass", pass);
  nvs_commit(h);
  nvs_close(h);
}

void net_forget(void) {
  nvs_handle_t h;
  if (nvs_open("wifi", NVS_READWRITE, &h) == ESP_OK) {
    nvs_erase_all(h);
    nvs_commit(h);
    nvs_close(h);
  }
}

// ---- events ----------------------------------------------------------------

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(s_events, GOT_IP);
    if (s_joining && ++s_retries > 5) {
      xEventGroupSetBits(s_events, JOIN_FAILED);
      return;
    }
    if (!s_joining) tell(NET_RECONNECTING, NULL);
    vTaskDelay(pdMS_TO_TICKS(s_joining ? 1000 : 5000));
    esp_wifi_connect();
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    s_retries = 0;
    xEventGroupSetBits(s_events, GOT_IP);
    tell(NET_ONLINE, NULL);
  }
}

// ---- captive DNS: every name -> 192.168.4.1 ---------------------------------

static void dns_task(void *arg) {
  int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(53), .sin_addr.s_addr = htonl(INADDR_ANY) };
  bind(sock, (struct sockaddr *)&addr, sizeof addr);
  uint8_t buf[512];
  for (;;) {
    struct sockaddr_in from;
    socklen_t flen = sizeof from;
    int n = recvfrom(sock, buf, sizeof buf - 16, 0, (struct sockaddr *)&from, &flen);
    if (n < 12) continue;
    buf[2] = 0x81; buf[3] = 0x80;          // response, recursion available, no error
    buf[6] = 0; buf[7] = 1;                // one answer
    buf[8] = buf[9] = buf[10] = buf[11] = 0;
    const uint8_t answer[] = { 0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 168, 4, 1 };
    memcpy(buf + n, answer, sizeof answer);
    sendto(sock, buf, n + sizeof answer, 0, (struct sockaddr *)&from, flen);
  }
}

// ---- setup page ------------------------------------------------------------

static const char PAGE_HEAD[] =
  "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>Friend Flower Setup</title><style>"
  "body{background:#0d0c0b;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;margin:0;padding:28px 22px}"
  "h1{font-size:26px;margin:0 0 6px}p{color:#b9b2ae;font-size:15px;line-height:1.4}"
  "select,input,button{width:100%;box-sizing:border-box;font-size:17px;padding:14px;border-radius:14px;margin:8px 0;"
  "border:1.5px solid #3a352e;background:#1a1816;color:#fff}button{background:#e6a8bd;color:#0d0c0b;border:0;font-weight:700}"
  "</style></head><body><h1>Friend Flower</h1>";

static esp_err_t page_root(httpd_req_t *req) {
  wifi_scan_config_t scan = { 0 };
  esp_wifi_scan_start(&scan, true);
  uint16_t count = 20;
  wifi_ap_record_t aps[20];
  esp_wifi_scan_get_ap_records(&count, aps);

  httpd_resp_set_type(req, "text/html");
  httpd_resp_sendstr_chunk(req, PAGE_HEAD);
  httpd_resp_sendstr_chunk(req, "<p>Pick your Wi-Fi so your device can show who's nearby.</p>"
                                "<form method=post action=/save><select name=s>");
  char line[160];
  for (int i = 0; i < count; i++) {
    if (!aps[i].ssid[0]) continue;
    bool dup = false;
    for (int j = 0; j < i; j++) dup |= strcmp((char *)aps[j].ssid, (char *)aps[i].ssid) == 0;
    if (dup) continue;
    snprintf(line, sizeof line, "<option>%s</option>", (char *)aps[i].ssid);
    httpd_resp_sendstr_chunk(req, line);
  }
  httpd_resp_sendstr_chunk(req, "</select><input name=o placeholder='Or type a network name'>"
                                "<input name=p type=password placeholder='Wi-Fi password'>"
                                "<button>Connect</button></form></body></html>");
  return httpd_resp_sendstr_chunk(req, NULL);
}

// application/x-www-form-urlencoded value for `key`, decoded into out.
static void form_value(const char *body, const char *key, char *out, size_t len) {
  out[0] = 0;
  size_t klen = strlen(key);
  for (const char *p = body; p && *p; p = strchr(p, '&') ? strchr(p, '&') + 1 : NULL) {
    if (strncmp(p, key, klen) || p[klen] != '=') continue;
    const char *v = p + klen + 1;
    size_t o = 0;
    while (*v && *v != '&' && o + 1 < len) {
      if (*v == '+') { out[o++] = ' '; v++; }
      else if (*v == '%' && v[1] && v[2]) { char hex[3] = { v[1], v[2], 0 }; out[o++] = (char)strtol(hex, NULL, 16); v += 3; }
      else out[o++] = *v++;
    }
    out[o] = 0;
    return;
  }
}

static void join_task(void *arg);

static esp_err_t page_save(httpd_req_t *req) {
  char body[256] = { 0 }, ssid[33], other[33], pass[65];
  int n = httpd_req_recv(req, body, sizeof body - 1);
  if (n <= 0) return ESP_FAIL;
  form_value(body, "s", ssid, sizeof ssid);
  form_value(body, "o", other, sizeof other);
  form_value(body, "p", pass, sizeof pass);
  if (other[0]) strcpy(ssid, other);
  httpd_resp_set_type(req, "text/html");
  httpd_resp_sendstr_chunk(req, PAGE_HEAD);
  httpd_resp_sendstr_chunk(req, "<p>Connecting&hellip; Look at your device. If it comes back to this setup, "
                                "the password didn't work. You can rejoin <b>Friend Flower Setup</b> and try again.</p></body></html>");
  httpd_resp_sendstr_chunk(req, NULL);
  save_creds(ssid, pass);
  xTaskCreate(join_task, "join", 4096, NULL, 5, NULL);
  return ESP_OK;
}

static esp_err_t page_redirect(httpd_req_t *req, httpd_err_code_t err) {
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
  return httpd_resp_send(req, NULL, 0);
}

static void start_setup(const char *why) {
  ESP_LOGI(TAG, "setup hotspot (%s)", why ? why : "no network saved");
  s_joining = false;
  esp_wifi_stop();
  esp_wifi_set_mode(WIFI_MODE_APSTA);
  wifi_config_t ap = { .ap = { .ssid = SETUP_SSID, .ssid_len = strlen(SETUP_SSID), .channel = 1,
                               .max_connection = 4, .authmode = WIFI_AUTH_OPEN } };
  esp_wifi_set_config(WIFI_IF_AP, &ap);
  esp_wifi_start();
  if (!s_http) {
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.stack_size = 8192;
    cfg.lru_purge_enable = true;
    if (httpd_start(&s_http, &cfg) == ESP_OK) {
      httpd_uri_t root = { .uri = "/", .method = HTTP_GET, .handler = page_root };
      httpd_uri_t save = { .uri = "/save", .method = HTTP_POST, .handler = page_save };
      httpd_register_uri_handler(s_http, &root);
      httpd_register_uri_handler(s_http, &save);
      httpd_register_err_handler(s_http, HTTPD_404_NOT_FOUND, page_redirect);
    }
  }
  if (!s_dns) xTaskCreate(dns_task, "dns", 3072, NULL, 4, &s_dns);
  tell(NET_SETUP, why);
}

static void stop_setup(void) {
  if (s_http) { httpd_stop(s_http); s_http = NULL; }
  if (s_dns) { vTaskDelete(s_dns); s_dns = NULL; }
}

static void join_task(void *arg) {
  char ssid[33], pass[65];
  if (!load_creds(ssid, sizeof ssid, pass, sizeof pass)) { start_setup(NULL); vTaskDelete(NULL); }
  vTaskDelay(pdMS_TO_TICKS(500)); // let the phone get the "Connecting" page
  tell(NET_JOINING, ssid);
  s_joining = true;
  s_retries = 0;
  xEventGroupClearBits(s_events, GOT_IP | JOIN_FAILED);
  esp_wifi_stop();
  esp_wifi_set_mode(WIFI_MODE_STA);
  wifi_config_t sta = { 0 };
  strlcpy((char *)sta.sta.ssid, ssid, sizeof sta.sta.ssid);
  strlcpy((char *)sta.sta.password, pass, sizeof sta.sta.password);
  sta.sta.threshold.authmode = pass[0] ? WIFI_AUTH_WEP : WIFI_AUTH_OPEN;
  esp_wifi_set_config(WIFI_IF_STA, &sta);
  esp_wifi_start();
  // No modem sleep: some routers stop delivering frames to a sleeping device,
  // which leaves it "connected" but unable to reach anything.
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_connect();
  EventBits_t bits = xEventGroupWaitBits(s_events, GOT_IP | JOIN_FAILED, pdFALSE, pdFALSE, pdMS_TO_TICKS(JOIN_TIMEOUT_MS));
  s_joining = false;
  if (bits & GOT_IP) stop_setup();
  else start_setup("That Wi-Fi password didn't work");
  vTaskDelete(NULL);
}

void net_start(net_state_cb_t cb) {
  s_cb = cb;
  s_events = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  s_sta = esp_netif_create_default_wifi_sta();
  s_ap = esp_netif_create_default_wifi_ap();
  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&cfg));
  esp_wifi_set_storage(WIFI_STORAGE_RAM);
  esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL);
  esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL);
  char ssid[33], pass[65];
  if (load_creds(ssid, sizeof ssid, pass, sizeof pass)) xTaskCreate(join_task, "join", 4096, NULL, 5, NULL);
  else start_setup(NULL);
}

bool net_online(void) { return s_events && (xEventGroupGetBits(s_events) & GOT_IP); }

// Drop and rejoin the network; the disconnect handler above reconnects.
void net_kick(void) {
  if (s_joining || !net_online()) return;
  ESP_LOGW(TAG, "nothing gets through, rejoining Wi-Fi");
  esp_wifi_disconnect();
}
