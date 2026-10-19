// The device side of /api/device/fo: one clip up, then wait for Fo.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_lvgl_port.h"
#include "api.h"
#include "board.h"
#include "fo.h"

#define WAIT_MS 240000  // stop waiting on Fo after 4 minutes

typedef struct {
  char query[96];
  fo_cb_t cb;
  void *ctx;
  int gen;
  const uint8_t *wav;
  size_t len;
} ask_t;

static volatile int s_gen;
static volatile bool s_busy;
static ask_t s_ask;

bool fo_listen(void) {
  if (s_busy || board_mic_recording()) return false;
  return board_mic_start() == ESP_OK;
}

bool fo_listening(void) { return board_mic_recording(); }

void fo_cancel(void) {
  s_gen++;
  if (board_mic_recording()) {
    const uint8_t *wav;
    board_mic_stop(&wav);
  }
}

// Calls back only if this request is still the one the screen is waiting on.
static void tell(const ask_t *a, fo_event_t ev, const char *text) {
  lvgl_port_lock(0);
  if (a->gen == s_gen) a->cb(ev, text ? text : "", a->ctx);
  lvgl_port_unlock();
}

static const char *str(const cJSON *j, const char *key) {
  const cJSON *v = cJSON_GetObjectItem(j, key);
  return cJSON_IsString(v) ? v->valuestring : NULL;
}

// Returns true when Fo is still working.
static bool report(const ask_t *a, int st, const cJSON *j) {
  const char *status = str(j, "status"), *text = str(j, "text");
  if (st != 200 || !status) { tell(a, FO_FAILED, "Couldn't reach Fo. Please try again."); return false; }
  if (!strcmp(status, "working")) { tell(a, FO_WORKING, text); return true; }
  tell(a, strcmp(status, "failed") ? FO_DONE : FO_FAILED, text);
  return false;
}

static void ask_job(void *arg) {
  const ask_t *a = arg;
  char path[128];
  snprintf(path, sizeof path, "/api/device/fo?%s", a->query);
  api_body_t b = { 0 };
  int st = api_http("POST", path, "audio/wav", a->wav, a->len, 60000, &b);
  cJSON *j = b.buf ? cJSON_Parse(b.buf) : NULL;
  api_body_free(&b);
  if (str(j, "heard")) tell(a, FO_HEARD, str(j, "heard"));
  bool working = report(a, st, j);
  cJSON_Delete(j);

  TickType_t start = xTaskGetTickCount();
  while (working && a->gen == s_gen) {
    if (pdTICKS_TO_MS(xTaskGetTickCount() - start) > WAIT_MS) {
      tell(a, FO_FAILED, "Fo is still working on it. You'll see the answer at friendflower.app.");
      break;
    }
    st = api_json("GET", path, NULL, 40000, &j);  // the server waits up to 25 s for news
    working = report(a, st, j);
    cJSON_Delete(j);
  }
  s_busy = false;
}

void fo_send(const char *query, fo_cb_t cb, void *ctx) {
  if (s_busy) return;
  s_busy = true;
  s_ask = (ask_t){ .cb = cb, .ctx = ctx, .gen = ++s_gen };
  s_ask.len = board_mic_stop(&s_ask.wav);  // the clip stays put until s_busy clears
  snprintf(s_ask.query, sizeof s_ask.query, "%s", query);
  if (!api_job(ask_job, &s_ask)) {
    s_busy = false;
    cb(FO_FAILED, "Busy right now. Try again in a moment.", ctx);
  }
}
