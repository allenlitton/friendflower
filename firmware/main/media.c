// Round photos and the Places map, fetched from /api/device/avatar and
// /api/device/map as raw LVGL pixels (RGB565A8 / RGB565) and kept in PSRAM.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "api.h"
#include "media.h"

static const char *TAG = "media";
#define MAX_AVATARS 48

typedef struct {
  char key[48];
  char id[40];
  int size;
  bool halo, queued;
  media_img_t img;
} avatar_t;

static avatar_t s_avatars[MAX_AVATARS];
static media_map_t s_map;
static char s_map_key[256];
static int s_map_w, s_map_h, s_map_vw, s_map_vh;
static bool s_map_queued, s_map_has_view;
static int s_view_zoom;
static double s_view_lat, s_view_lng;
static void (*s_on_ready)(void);

void media_start(void (*on_ready)(void)) { s_on_ready = on_ready; }

static void set_dsc(lv_image_dsc_t *d, lv_color_format_t cf, int w, int h, const uint8_t *data, int len) {
  if (d->data) lv_image_cache_drop(d);
  d->header.magic = LV_IMAGE_HEADER_MAGIC;
  d->header.cf = cf;
  d->header.w = w;
  d->header.h = h;
  d->header.stride = w * 2;
  d->data_size = len;
  d->data = data;
}

// Takes the body's bytes as the image (moved into PSRAM).
static uint8_t *keep(api_body_t *b, int want) {
  if (b->len != want) return NULL;
  uint8_t *p = heap_caps_malloc(want, MALLOC_CAP_SPIRAM);
  if (p) memcpy(p, b->buf, want);
  return p;
}

static void fetch_avatar(void *arg) {
  avatar_t *a = arg;
  char path[128];
  snprintf(path, sizeof path, "/api/device/avatar/%s?size=%d%s", a->id, a->size, a->halo ? "&halo=1" : "");
  api_body_t b = { .header = "x-photo" };
  int st = api_http("GET", path, NULL, NULL, 0, 20000, &b);
  uint8_t *px = st == 200 ? keep(&b, a->size * a->size * 3) : NULL;
  bool photo = b.header_value[0] == '1';
  api_body_free(&b);
  lvgl_port_lock(0);
  a->queued = false;  // a failed fetch is tried again the next time it's asked for
  if (!px) { ESP_LOGW(TAG, "avatar %s: %d", a->id, st); lvgl_port_unlock(); return; }
  set_dsc(&a->img.dsc, LV_COLOR_FORMAT_RGB565A8, a->size, a->size, px, a->size * a->size * 3);
  a->img.photo = photo;
  a->img.ready = true;
  if (s_on_ready) s_on_ready();
  lvgl_port_unlock();
}

const media_img_t *media_avatar(const char *id, int size, bool halo) {
  char key[48];
  snprintf(key, sizeof key, "%.36s/%d/%d", id ? id : "", size, halo);
  avatar_t *free_slot = NULL;
  for (int i = 0; i < MAX_AVATARS; i++) {
    if (!strcmp(s_avatars[i].key, key)) {
      avatar_t *a = &s_avatars[i];
      if (!a->img.ready && !a->queued) a->queued = api_job(fetch_avatar, a);
      return &a->img;
    }
    if (!s_avatars[i].key[0] && !free_slot) free_slot = &s_avatars[i];
  }
  if (!id || !free_slot) return NULL;
  avatar_t *a = free_slot;
  snprintf(a->key, sizeof a->key, "%s", key);
  snprintf(a->id, sizeof a->id, "%.36s", id);
  a->size = size;
  a->halo = halo;
  a->queued = api_job(fetch_avatar, a);
  return &a->img;
}

static void fetch_map(void *arg) {
  char path[192], key[sizeof s_map_key];
  lvgl_port_lock(0);  // media_map / media_map_view change these on the LVGL task
  int w = s_map_w, h = s_map_h, n = snprintf(path, sizeof path, "/api/device/map?w=%d&h=%d&vw=%d&vh=%d", w, h, s_map_vw, s_map_vh);
  if (s_map_has_view) snprintf(path + n, sizeof path - n, "&z=%d&lat=%.6f&lng=%.6f", s_view_zoom, s_view_lat, s_view_lng);
  snprintf(key, sizeof key, "%s", s_map_key);
  bool had_view = s_map_has_view;
  int vz = s_view_zoom;
  double vlat = s_view_lat, vlng = s_view_lng;
  lvgl_port_unlock();

  api_body_t b = { .header = "x-map" };
  int st = api_http("GET", path, NULL, NULL, 0, 30000, &b);
  uint8_t *px = st == 200 ? keep(&b, w * h * 2) : NULL;
  // "zoom,lat,lng|x,y;x,y;..."
  int zoom = 0, used = 0, pins = 0;
  double lat = 0, lng = 0;
  lv_point_t pin[MEDIA_MAX_PINS];
  if (px && sscanf(b.header_value, "%d,%lf,%lf|%n", &zoom, &lat, &lng, &used) == 3) {
    for (char *p = b.header_value + used; *p && pins < MEDIA_MAX_PINS; ) {
      int x, y, u;
      if (sscanf(p, "%d,%d%n", &x, &y, &u) != 2) break;
      pin[pins++] = (lv_point_t){ x, y };
      p += u;
      if (*p == ';') p++;
    }
  } else if (px) { free(px); px = NULL; }
  api_body_free(&b);

  lvgl_port_lock(0);
  s_map_queued = false;
  bool current = !strcmp(key, s_map_key) && w == s_map_w && h == s_map_h && had_view == s_map_has_view &&
                 (!had_view || (vz == s_view_zoom && vlat == s_view_lat && vlng == s_view_lng));
  if (!px) {
    ESP_LOGW(TAG, "map: %d", st);
    s_map.loading = false;
    if (s_on_ready) s_on_ready();  // so the screen stops saying it's loading
  } else if (!current) {
    free(px);
    s_map_queued = api_job(fetch_map, NULL);  // asked for something else meanwhile
  } else {
    uint8_t *old = (uint8_t *)s_map.dsc.data;
    set_dsc(&s_map.dsc, LV_COLOR_FORMAT_RGB565, w, h, px, w * h * 2);
    free(old);
    memcpy(s_map.pin, pin, sizeof pin);
    s_map.pins = pins;
    s_map.zoom = zoom;
    s_map.lat = lat;
    s_map.lng = lng;
    s_map.version++;
    s_map.ready = true;
    s_map.loading = false;
    if (s_on_ready) s_on_ready();
  }
  lvgl_port_unlock();
}

static void queue_map(void) {
  if (!s_map_queued) s_map_queued = api_job(fetch_map, NULL);
  s_map.loading = s_map_queued;
}

const media_map_t *media_map(const char *key, int w, int h, int vw, int vh) {
  if (strcmp(key, s_map_key) || w != s_map_w || h != s_map_h || vw != s_map_vw || vh != s_map_vh) {
    snprintf(s_map_key, sizeof s_map_key, "%s", key);
    s_map_w = w; s_map_h = h; s_map_vw = vw; s_map_vh = vh;
    s_map_has_view = false;  // new places: frame them all again
    s_map.ready = false;
    queue_map();
  }
  return &s_map;
}

void media_map_view(int zoom, double lat, double lng) {
  s_map_has_view = true;
  s_view_zoom = zoom < 10 ? 10 : zoom > 18 ? 18 : zoom;
  s_view_lat = lat;
  s_view_lng = lng;
  queue_map();
}
