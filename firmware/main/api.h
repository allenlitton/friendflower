#pragma once
#include <stdbool.h>
#include "cJSON.h"

typedef enum {
  API_CODE,      // data: the 6-letter code to show (const char *)
  API_LINKED,    // linked; summaries will follow
  API_SUMMARY,   // data: cJSON * from /api/device/summary (receiver must cJSON_Delete it)
  API_OFFLINE,   // couldn't reach friendflower.app; will retry
  API_UNLINKED,  // removed at friendflower.app/device; a new code will follow
} api_event_t;

typedef void (*api_cb_t)(api_event_t ev, void *data);

void api_start(api_cb_t cb);
void api_refresh(void);  // fetch again now instead of waiting a minute
void api_unlink(void);   // forget the link and the secret (takes effect on restart)

// A response body (any bytes, NUL-terminated) and optionally one header's value.
typedef struct {
  char *buf;
  int len, cap;
  const char *header;      // set before the call to capture this response header
  char header_value[512];
} api_body_t;

// Requests to friendflower.app with the device's key. Return the HTTP status, or -1.
int api_http(const char *method, const char *path, const char *type, const void *body, int body_len,
             int timeout_ms, api_body_t *out);
int api_json(const char *method, const char *path, const char *json_body, int timeout_ms, cJSON **out);
void api_body_free(api_body_t *b);

// Run fn(arg) on the API's job task (one at a time, once online). False if the queue is full.
bool api_job(void (*fn)(void *), void *arg);
