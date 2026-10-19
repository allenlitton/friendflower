#pragma once
#include <stdbool.h>

// Talking to Fo: record, then send the clip to /api/device/fo, which turns it
// into text and asks Fo. Fo's progress and reply come back through the
// callback, which runs with LVGL locked. One request at a time.
typedef enum {
  FO_HEARD,    // text: what we heard you say
  FO_WORKING,  // text: Fo's latest progress line
  FO_DONE,     // text: Fo's reply
  FO_FAILED,   // text: what went wrong, in plain words
} fo_event_t;
typedef void (*fo_cb_t)(fo_event_t ev, const char *text, void *ctx);

bool fo_listen(void);                                // start recording; false if busy or no mic
bool fo_listening(void);                             // still recording (stops by itself at 15 s)
void fo_send(const char *query, fo_cb_t cb, void *ctx);  // stop and ask; query e.g. "page=places"
void fo_cancel(void);                                // stop recording; ignore any reply still coming
