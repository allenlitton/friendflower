#pragma once
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
