#pragma once
#include <stdbool.h>
#include "lvgl.h"

// Pictures the server draws for the device: round photos and the Places map.
// Entries live for the whole run (never freed), so the UI can keep pointers.
// Asking for one that isn't here yet fetches it in the background; when it
// lands, the callback given to media_start runs with LVGL locked.

typedef struct {
  lv_image_dsc_t dsc;
  bool ready;
  bool photo;     // false: just the gradient, so draw initials on top
} media_img_t;

#define MEDIA_MAX_PINS 15
typedef struct {
  lv_image_dsc_t dsc;  // bigger than the window on screen, so it can be dragged
  bool ready;
  bool loading;        // a new picture is on its way
  unsigned version;    // goes up with every new picture
  int zoom;
  double lat, lng;     // the picture's centre
  int pins;
  lv_point_t pin[MEDIA_MAX_PINS];  // in place order, so the list can number them
} media_map_t;

void media_start(void (*on_ready)(void));
const media_img_t *media_avatar(const char *id, int size, bool halo);
// The map for these places (key: anything that changes when they do, e.g.
// their ids), drawn w x h and framed to fit a vw x vh window.
const media_map_t *media_map(const char *key, int w, int h, int vw, int vh);
// Redraw the same places at this zoom and centre (zooming and panning).
void media_map_view(int zoom, double lat, double lng);
