// The round screen: swipe left/right between Home, Nearby, Chats, Trips and
// Places. Lists scroll up and down. Hold Home for 3 seconds for settings.
// Tap a chat to open it (chat.c); the Fo button talks to Fo (talk.c).
// Setup, the link code and connection problems show full screen on top.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_lvgl_port.h"
#include "esp_system.h"
#include "media.h"
#include "ui.h"
#include "ui_common.h"

#define MAX_PETALS 12
#define FLOWER_Y 148
#define PETAL_SCALE 210  // 256 = full size
#define LOGO_PETALS 5    // the five-heart logo
#define SPIN_MS 12000    // one full turn
#define FACE 56          // Nearby photos
#define HALO 72          // Chats photos, petals included
#define MAP_W 300   // the window on screen
#define MAP_H 190
#define IMG_W 560   // the picture behind it, which you drag around
#define IMG_H 360

LV_IMAGE_DECLARE(img_petal);
LV_IMAGE_DECLARE(img_face);

enum { HOME, NEARBY, CHATS, TRIPS, PLACES, PAGES };
static const char *TITLES[PAGES] = { "", "Nearby", "Chats", "Trips", "Places" };

static lv_obj_t *s_tiles, *s_page[PAGES], *s_list[PAGES], *s_dots[PAGES];
static lv_obj_t *s_petals[MAX_PETALS], *s_count, *s_overlay, *s_ov_title, *s_ov_code, *s_ov_body, *s_settings;
static lv_obj_t *s_map_box, *s_map_scroll, *s_map_wait;
static unsigned s_map_shown;
static bool s_map_moving;  // we're scrolling the map ourselves, not a finger
static char s_places_key[256];
static ui_action_cb_t s_action;
static int s_shown;

// ---- text ------------------------------------------------------------------

// The built-in fonts are ASCII only: fold accented letters to plain ones and
// drop anything else that isn't ASCII (emoji, CJK).
void ui_ascii(const char *in, char *out, size_t len) {
  static const char LATIN1[] = "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";
  size_t o = 0;
  for (const unsigned char *p = (const unsigned char *)(in ? in : ""); *p && o + 1 < len; ) {
    if (*p < 0x80) { out[o++] = *p++; continue; }
    if ((*p & 0xE0) == 0xC0 && p[1]) {
      unsigned cp = ((p[0] & 0x1F) << 6) | (p[1] & 0x3F);
      if (cp >= 0xC0 && cp <= 0xFF) out[o++] = LATIN1[cp - 0xC0];
      else if (cp == 0xB7) out[o++] = '-';
      p += 2;
      continue;
    }
    if ((*p & 0xF0) == 0xE0 && p[1] && p[2]) {
      unsigned cp = ((p[0] & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F);
      if (cp == 0x2019 || cp == 0x2018) out[o++] = '\'';
      else if (cp == 0x201C || cp == 0x201D) out[o++] = '"';
      else if (cp == 0x2013 || cp == 0x2014) out[o++] = '-';
      else if (cp == 0x2026 && o + 3 < len) { memcpy(out + o, "...", 3); o += 3; }
      p += 3;
      continue;
    }
    p++;
    while ((*p & 0xC0) == 0x80) p++;
  }
  out[o] = 0;
}

const char *ui_str(const cJSON *o, const char *key) {
  const cJSON *v = cJSON_GetObjectItem(o, key);
  return cJSON_IsString(v) ? v->valuestring : NULL;
}

static double num(const cJSON *o, const char *key, double fallback) {
  const cJSON *v = cJSON_GetObjectItem(o, key);
  return cJSON_IsNumber(v) ? v->valuedouble : fallback;
}

static void month_day(const char *iso, char *out, size_t len) {
  static const char *M[] = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
  int y, m, d;
  if (iso && sscanf(iso, "%d-%d-%d", &y, &m, &d) == 3 && m >= 1 && m <= 12) snprintf(out, len, "%s %d", M[m - 1], d);
  else snprintf(out, len, "?");
}

lv_obj_t *ui_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const char *text) {
  lv_obj_t *l = lv_label_create(parent);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, color, 0);
  lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
  lv_label_set_text(l, text);
  return l;
}

// ---- photos ------------------------------------------------------------------

// Each photo on screen remembers which picture it's waiting for. When pictures
// arrive (media.c), every waiting photo whose picture is ready fills itself in.
typedef struct {
  const media_img_t *img;
  char initial[2];
  bool halo, shown;
} avatar_ud_t;

#define MAX_ON_SCREEN 64
static lv_obj_t *s_avatars[MAX_ON_SCREEN];

static void avatar_fill(lv_obj_t *box) {
  avatar_ud_t *ud = lv_obj_get_user_data(box);
  if (!ud || ud->shown || !ud->img || !ud->img->ready) return;
  ud->shown = true;
  lv_obj_clean(box);
  lv_obj_t *im = lv_image_create(box);
  lv_image_set_src(im, &ud->img->dsc);
  lv_obj_center(im);
  if (!ud->img->photo && ud->initial[0]) {
    lv_obj_t *l = ui_label(box, ud->halo ? &lv_font_montserrat_20 : &lv_font_montserrat_28, lv_color_white(), ud->initial);
    lv_obj_center(l);
  }
}

static void on_avatar_delete(lv_event_t *e) {
  lv_obj_t *box = lv_event_get_target(e);
  for (int i = 0; i < MAX_ON_SCREEN; i++) if (s_avatars[i] == box) s_avatars[i] = NULL;
  lv_free(lv_obj_get_user_data(box));
}

lv_obj_t *ui_avatar(lv_obj_t *parent, const char *id, int size, bool halo, const char *name) {
  lv_obj_t *box = lv_obj_create(parent);
  lv_obj_remove_style_all(box);
  lv_obj_set_size(box, size, size);
  lv_obj_remove_flag(box, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(box, LV_OBJ_FLAG_EVENT_BUBBLE);
  // Until the photo arrives: a plain dot where the face will be.
  lv_obj_t *dot = lv_obj_create(box);
  lv_obj_remove_style_all(dot);
  int d = halo ? size * 64 / 100 : size;
  lv_obj_set_size(dot, d, d);
  lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(dot, FAINT, 0);
  lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
  lv_obj_center(dot);

  avatar_ud_t *ud = lv_malloc_zeroed(sizeof *ud);
  if (!ud) return box;
  ud->img = media_avatar(id, size, halo);
  ud->halo = halo;
  char a[8];
  ui_ascii(name, a, sizeof a);
  ud->initial[0] = a[0] >= 'a' && a[0] <= 'z' ? a[0] - 32 : a[0];
  lv_obj_set_user_data(box, ud);
  lv_obj_add_event_cb(box, on_avatar_delete, LV_EVENT_DELETE, NULL);
  for (int i = 0; i < MAX_ON_SCREEN; i++) if (!s_avatars[i]) { s_avatars[i] = box; break; }
  avatar_fill(box);
  return box;
}

static void map_fill(void);

void ui_media_ready(void) {
  for (int i = 0; i < MAX_ON_SCREEN; i++) if (s_avatars[i]) avatar_fill(s_avatars[i]);
  map_fill();
}

// ---- pages -----------------------------------------------------------------

static void set_dots(int page) {
  for (int i = 0; i < PAGES; i++) {
    lv_obj_set_style_bg_color(s_dots[i], i == page ? PINK : FAINT, 0);
    lv_obj_set_size(s_dots[i], i == page ? 18 : 8, 8);
  }
}

static int current_page(void) {
  lv_obj_t *t = lv_tileview_get_tile_active(s_tiles);
  for (int i = 0; i < PAGES; i++) if (s_page[i] == t) return i;
  return HOME;
}

// What Fo is told about where you asked from (talk.c).
static const char *page_query(void) {
  switch (current_page()) {
    case TRIPS: return "page=trips";
    case PLACES: return "page=places";
    default: return "page=general";
  }
}

static void on_tile(lv_event_t *e) { set_dots(current_page()); }

// Settings open after holding Home for 3 seconds (not LVGL's default 0.4 s,
// so a slow swipe never opens them by accident).
static void on_home_hold(lv_event_t *e) {
  static uint32_t pressed_at;
  if (lv_event_get_code(e) == LV_EVENT_PRESSED) pressed_at = lv_tick_get();
  else if (lv_tick_elaps(pressed_at) >= 3000 && lv_obj_has_flag(s_settings, LV_OBJ_FLAG_HIDDEN))
    lv_obj_remove_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
}

static void make_list_page(int i) {
  lv_obj_t *t = s_page[i];
  lv_obj_t *title = ui_label(t, &lv_font_montserrat_28, PINK, TITLES[i]);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 42);
  lv_obj_t *list = lv_obj_create(t);
  s_list[i] = list;
  lv_obj_remove_style_all(list);
  lv_obj_set_size(list, 340, 318);
  lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 92);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_flex_align(list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_row(list, 14, 0);
  lv_obj_set_style_pad_bottom(list, 80, 0);  // room to scroll the last row above the Fo button
  lv_obj_set_scroll_dir(list, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
  lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLL_ELASTIC);
}

static void clear_list(int i) { lv_obj_clean(s_list[i]); }

static lv_obj_t *column(lv_obj_t *parent) {
  lv_obj_t *c = lv_obj_create(parent);
  lv_obj_remove_style_all(c);
  lv_obj_set_height(c, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(c, LV_FLEX_FLOW_COLUMN);
  lv_obj_remove_flag(c, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(c, LV_OBJ_FLAG_EVENT_BUBBLE);
  return c;
}

// A heading and a smaller line under it. Centred, or left-aligned next to a photo.
static void texts(lv_obj_t *col, bool dot, bool left, const char *head, const char *detail) {
  char a[96], b[200];
  ui_ascii(head, a, sizeof a);
  ui_ascii(detail, b, sizeof b);
  lv_obj_set_flex_align(col, LV_FLEX_ALIGN_START, left ? LV_FLEX_ALIGN_START : LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  if (a[0]) {
    lv_obj_t *h = ui_label(col, &lv_font_montserrat_20, dot ? PINK : lv_color_white(), a);
    lv_label_set_long_mode(h, LV_LABEL_LONG_DOT);
    lv_obj_set_width(h, lv_pct(100));
    if (left) lv_obj_set_style_text_align(h, LV_TEXT_ALIGN_LEFT, 0);
  }
  if (b[0]) {
    lv_obj_t *d = ui_label(col, &lv_font_montserrat_14, a[0] ? GREY : lv_color_white(), b);
    lv_label_set_long_mode(d, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(d, lv_pct(100));
    if (left) lv_obj_set_style_text_align(d, LV_TEXT_ALIGN_LEFT, 0);
  }
}

static void row(int page, bool dot, const char *head, const char *detail) {
  lv_obj_t *r = column(s_list[page]);
  lv_obj_set_width(r, lv_pct(100));
  texts(r, dot, false, head, detail);
}

// A row with a round photo on the left.
static lv_obj_t *photo_row(int page, const char *id, int size, bool halo, const char *name) {
  lv_obj_t *r = lv_obj_create(s_list[page]);
  lv_obj_remove_style_all(r);
  lv_obj_set_size(r, lv_pct(100), LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(r, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(r, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(r, 12, 0);
  lv_obj_remove_flag(r, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(r, LV_OBJ_FLAG_EVENT_BUBBLE);
  ui_avatar(r, id, size, halo, name);
  return r;
}

static void empty(int page, const char *text) {
  lv_obj_t *l = ui_label(s_list[page], &lv_font_montserrat_20, GREY, text);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, lv_pct(90));
  lv_obj_set_style_pad_top(l, 50, 0);
}

static void make_home(void) {
  lv_obj_t *t = s_page[HOME];
  for (int i = 0; i < MAX_PETALS; i++) {
    lv_obj_t *p = lv_image_create(t);
    lv_image_set_src(p, &img_petal);
    lv_image_set_pivot(p, 46, 136);
    lv_image_set_scale(p, PETAL_SCALE);
    lv_obj_set_pos(p, W / 2 - 46, FLOWER_Y - 136);
    lv_obj_add_flag(p, LV_OBJ_FLAG_HIDDEN);
    s_petals[i] = p;
  }
  lv_obj_t *face = lv_image_create(t);
  lv_image_set_src(face, &img_face);
  lv_image_set_scale(face, PETAL_SCALE);
  lv_obj_set_pos(face, W / 2 - 56, FLOWER_Y - 56);

  s_count = ui_label(t, &lv_font_montserrat_20, GREY, "");
  lv_obj_align(s_count, LV_ALIGN_TOP_MID, 0, 266);
  lv_obj_t *q = ui_label(t, &lv_font_montserrat_28, lv_color_white(), "Looking for friends\nof friends?");
  lv_obj_set_style_text_line_space(q, 4, 0);
  lv_obj_align(q, LV_ALIGN_TOP_MID, 0, 298);
  lv_obj_add_event_cb(t, on_home_hold, LV_EVENT_PRESSED, NULL);
  lv_obj_add_event_cb(t, on_home_hold, LV_EVENT_LONG_PRESSED_REPEAT, NULL);
}

static void spin(void *var, int32_t angle) {
  for (int i = 0; i < s_shown; i++) lv_image_set_rotation(s_petals[i], (i * 3600 / s_shown + angle) % 3600);
}

static void set_petals(int n) {
  if (n > MAX_PETALS) n = MAX_PETALS;
  s_shown = n;
  for (int i = 0; i < MAX_PETALS; i++) {
    if (i < n) lv_obj_remove_flag(s_petals[i], LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(s_petals[i], LV_OBJ_FLAG_HIDDEN);
  }
  spin(NULL, 0);
}

// For now Home shows the full logo flower turning slowly, not one petal per
// nearby person.
static void start_spin(void) {
  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, s_petals);
  lv_anim_set_exec_cb(&a, spin);
  lv_anim_set_values(&a, 0, 3600);
  lv_anim_set_duration(&a, SPIN_MS);
  lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
  lv_anim_start(&a);
}

// ---- Places map ----------------------------------------------------------------
// A window onto a bigger picture: drag to look around, double-tap a spot to
// zoom in on it, or use + and -. The server draws each new zoom or centre
// (media.c); numbered pins match the list below. The screen senses one finger
// at a time, so there's no pinch.

static void on_map_delete(lv_event_t *e) { s_map_box = s_map_scroll = s_map_wait = NULL; }

// Where a point in the picture is, from the picture's zoom and centre (Web Mercator).
static void map_latlng(const media_map_t *m, int x, int y, double *lat, double *lng) {
  double scale = 256.0 * pow(2, m->zoom);
  double s = sin(m->lat * M_PI / 180);
  double cx = (m->lng + 180) / 360 * scale + (x - IMG_W / 2);
  double cy = (0.5 - log((1 + s) / (1 - s)) / (4 * M_PI)) * scale + (y - IMG_H / 2);
  *lng = cx / scale * 360 - 180;
  *lat = atan(sinh(M_PI - 2 * M_PI * cy / scale)) * 180 / M_PI;
}

static void map_ask(int zoom_by, int x, int y) {
  const media_map_t *m = s_map_box ? lv_obj_get_user_data(s_map_box) : NULL;
  // One new picture at a time: until it lands, the window's position means nothing new.
  if (!m || !m->ready || m->loading) return;
  double lat, lng;
  map_latlng(m, x, y, &lat, &lng);
  media_map_view(m->zoom + zoom_by, lat, lng);
  map_fill();  // shows "Loading map..."
}

// The middle of the window, in picture pixels.
static void map_view_centre(int *x, int *y) {
  *x = lv_obj_get_scroll_x(s_map_scroll) + MAP_W / 2;
  *y = lv_obj_get_scroll_y(s_map_scroll) + MAP_H / 2;
}

static void on_map_zoom(lv_event_t *e) {
  int x, y;
  map_view_centre(&x, &y);
  map_ask((int)(intptr_t)lv_event_get_user_data(e), x, y);
}

static void on_map_double_tap(lv_event_t *e) {
  lv_point_t p;
  lv_area_t a;
  lv_indev_get_point(lv_indev_active(), &p);
  lv_obj_get_coords(s_map_scroll, &a);
  map_ask(1, p.x - a.x1 + lv_obj_get_scroll_x(s_map_scroll), p.y - a.y1 + lv_obj_get_scroll_y(s_map_scroll));
}

// After a drag that nears the picture's edge, draw a new one centred there.
static void on_map_scrolled(lv_event_t *e) {
  if (s_map_moving) return;
  int x, y;
  map_view_centre(&x, &y);
  if (abs(x - IMG_W / 2) > 70 || abs(y - IMG_H / 2) > 45) map_ask(0, x, y);
}

static lv_obj_t *map_button(const char *text, int zoom_by, int y) {
  lv_obj_t *b = lv_button_create(s_map_box);
  lv_obj_remove_style_all(b);
  lv_obj_set_size(b, 34, 34);
  lv_obj_align(b, LV_ALIGN_RIGHT_MID, -8, y);
  lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(b, BG, 0);
  lv_obj_set_style_bg_opa(b, LV_OPA_80, 0);
  lv_obj_set_style_border_color(b, PINK, 0);
  lv_obj_set_style_border_width(b, 2, 0);
  lv_obj_set_ext_click_area(b, 6);
  lv_obj_t *l = ui_label(b, &lv_font_montserrat_20, PINK, text);
  lv_obj_center(l);
  lv_obj_add_event_cb(b, on_map_zoom, LV_EVENT_CLICKED, (void *)(intptr_t)zoom_by);
  return b;
}

static void map_card(const char *key) {
  s_map_box = lv_obj_create(s_list[PLACES]);
  lv_obj_remove_style_all(s_map_box);
  lv_obj_set_size(s_map_box, MAP_W, MAP_H);
  lv_obj_set_style_radius(s_map_box, 24, 0);
  lv_obj_set_style_clip_corner(s_map_box, true, 0);
  lv_obj_set_style_bg_color(s_map_box, CARD, 0);
  lv_obj_set_style_bg_opa(s_map_box, LV_OPA_COVER, 0);
  lv_obj_remove_flag(s_map_box, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_event_cb(s_map_box, on_map_delete, LV_EVENT_DELETE, NULL);

  // Dragging here moves the map, not the list or the pages.
  s_map_scroll = lv_obj_create(s_map_box);
  lv_obj_remove_style_all(s_map_scroll);
  lv_obj_set_size(s_map_scroll, MAP_W, MAP_H);
  lv_obj_set_scrollbar_mode(s_map_scroll, LV_SCROLLBAR_MODE_OFF);
  lv_obj_remove_flag(s_map_scroll, LV_OBJ_FLAG_SCROLL_CHAIN | LV_OBJ_FLAG_SCROLL_ELASTIC);
  lv_obj_add_event_cb(s_map_scroll, on_map_double_tap, LV_EVENT_DOUBLE_CLICKED, NULL);
  lv_obj_add_event_cb(s_map_scroll, on_map_scrolled, LV_EVENT_SCROLL_END, NULL);

  map_button("+", 1, -22);
  map_button("-", -1, 22);
  lv_obj_t *credit = ui_label(s_map_box, &lv_font_montserrat_14, GREY, "(c) OpenStreetMap");
  lv_obj_set_style_text_opa(credit, LV_OPA_70, 0);
  lv_obj_align(credit, LV_ALIGN_BOTTOM_MID, 0, -4);
  s_map_wait = ui_label(s_map_box, &lv_font_montserrat_14, GREY, "Loading map...");
  lv_obj_align(s_map_wait, LV_ALIGN_TOP_MID, 0, 8);

  s_map_shown = 0;
  lv_obj_set_user_data(s_map_box, (void *)media_map(key, IMG_W, IMG_H, MAP_W, MAP_H));
  map_fill();
}

static void map_fill(void) {
  if (!s_map_box) return;
  const media_map_t *m = lv_obj_get_user_data(s_map_box);
  if (!m) return;
  if (m->loading) lv_obj_remove_flag(s_map_wait, LV_OBJ_FLAG_HIDDEN);
  else lv_obj_add_flag(s_map_wait, LV_OBJ_FLAG_HIDDEN);
  if (!m->ready || m->version == s_map_shown) return;
  s_map_shown = m->version;
  s_map_moving = true;  // clearing the old picture resets the scroll too
  lv_obj_clean(s_map_scroll);
  lv_obj_t *im = lv_image_create(s_map_scroll);
  lv_image_set_src(im, &m->dsc);
  lv_obj_add_flag(im, LV_OBJ_FLAG_EVENT_BUBBLE);
  for (int i = 0; i < m->pins; i++) {
    if (m->pin[i].x < 0 || m->pin[i].y < 0 || m->pin[i].x >= IMG_W || m->pin[i].y >= IMG_H) continue;
    char n[12];
    snprintf(n, sizeof n, "%d", i + 1);
    lv_obj_t *l = ui_label(s_map_scroll, &lv_font_montserrat_14, BG, n);
    lv_obj_add_flag(l, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_update_layout(l);
    lv_obj_set_pos(l, m->pin[i].x - lv_obj_get_width(l) / 2, m->pin[i].y - lv_obj_get_height(l) / 2);
  }
  lv_obj_update_layout(s_map_scroll);
  // scroll_to moves x, then y, and reports a scroll end in between: don't take that for a drag.
  lv_obj_scroll_to(s_map_scroll, (IMG_W - MAP_W) / 2, (IMG_H - MAP_H) / 2, LV_ANIM_OFF);
  s_map_moving = false;
}

// ---- Chats -------------------------------------------------------------------

typedef struct { char chat[40], member[40], name[40]; } chat_ref_t;

static void on_chat_tap(lv_event_t *e) {
  chat_ref_t *c = lv_event_get_user_data(e);
  chat_open(c->chat, c->member, c->name);
}

static void on_chat_row_delete(lv_event_t *e) { lv_free(lv_event_get_user_data(e)); }

// A chat: the friend's photo in a petal halo (no name) and the last message.
static void chat_row(const cJSON *c) {
  const cJSON *members = cJSON_GetObjectItem(c, "members");
  const char *member = cJSON_IsArray(members) && cJSON_IsString(cJSON_GetArrayItem(members, 0))
                       ? cJSON_GetArrayItem(members, 0)->valuestring : NULL;
  const char *title = ui_str(c, "title") ? ui_str(c, "title") : "";
  bool unread = cJSON_IsTrue(cJSON_GetObjectItem(c, "unread"));
  lv_obj_t *r = photo_row(CHATS, member, HALO, true, title);
  lv_obj_add_flag(r, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_t *col = column(r);
  lv_obj_set_flex_grow(col, 1);
  const char *sender = ui_str(c, "sender");
  char b[200];
  snprintf(b, sizeof b, "%s%s", sender && !strcmp(sender, "me") ? "You: " : "", ui_str(c, "body") ? ui_str(c, "body") : "");
  texts(col, false, true, unread ? "New message" : "", b);
  if (unread) lv_obj_set_style_text_color(lv_obj_get_child(col, 0), PINK, 0);

  chat_ref_t *ref = lv_malloc_zeroed(sizeof *ref);
  if (!ref || !ui_str(c, "id")) return;
  snprintf(ref->chat, sizeof ref->chat, "%s", ui_str(c, "id"));
  snprintf(ref->member, sizeof ref->member, "%s", member ? member : "");
  snprintf(ref->name, sizeof ref->name, "%s", title);
  lv_obj_add_event_cb(r, on_chat_tap, LV_EVENT_CLICKED, ref);
  lv_obj_add_event_cb(r, on_chat_row_delete, LV_EVENT_DELETE, ref);
}

// ---- overlays ----------------------------------------------------------------

lv_obj_t *ui_round_layer(void) {
  lv_obj_t *o = lv_obj_create(lv_layer_top());
  lv_obj_remove_style_all(o);
  lv_obj_set_size(o, W, W);
  lv_obj_set_style_bg_color(o, BG, 0);
  lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
  lv_obj_add_flag(o, LV_OBJ_FLAG_CLICKABLE);
  return o;
}

static void on_setting(lv_event_t *e) {
  ui_action_t a = (ui_action_t)(intptr_t)lv_event_get_user_data(e);
  if (a == UI_BACK) { lv_obj_add_flag(s_settings, LV_OBJ_FLAG_HIDDEN); return; }
  if (s_action) s_action(a);
}

static void setting_button(lv_obj_t *parent, const char *text, ui_action_t a, int y) {
  lv_obj_t *b = lv_button_create(parent);
  lv_obj_set_size(b, 260, 56);
  lv_obj_align(b, LV_ALIGN_TOP_MID, 0, y);
  lv_obj_set_style_radius(b, 16, 0);
  lv_obj_set_style_bg_color(b, a == UI_BACK ? PINK : CARD, 0);
  lv_obj_set_style_border_color(b, FAINT, 0);
  lv_obj_set_style_border_width(b, a == UI_BACK ? 0 : 2, 0);
  lv_obj_t *l = ui_label(b, &lv_font_montserrat_20, a == UI_BACK ? BG : lv_color_white(), text);
  lv_obj_center(l);
  lv_obj_add_event_cb(b, on_setting, LV_EVENT_CLICKED, (void *)(intptr_t)a);
}

static void make_overlays(void) {
  s_overlay = ui_round_layer();
  s_ov_title = ui_label(s_overlay, &lv_font_montserrat_28, PINK, "Friend Flower");
  lv_obj_align(s_ov_title, LV_ALIGN_TOP_MID, 0, 110);
  s_ov_code = ui_label(s_overlay, &lv_font_montserrat_40, lv_color_white(), "");
  lv_obj_set_style_text_letter_space(s_ov_code, 8, 0);
  lv_obj_align(s_ov_code, LV_ALIGN_TOP_MID, 0, 170);
  s_ov_body = ui_label(s_overlay, &lv_font_montserrat_20, GREY, "Starting...");
  lv_label_set_long_mode(s_ov_body, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(s_ov_body, 330);
  lv_obj_align(s_ov_body, LV_ALIGN_TOP_MID, 0, 240);

  s_settings = ui_round_layer();
  lv_obj_t *t = ui_label(s_settings, &lv_font_montserrat_28, PINK, "Settings");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 70);
  setting_button(s_settings, "Change Wi-Fi", UI_FORGET_WIFI, 140);
  setting_button(s_settings, "Unlink account", UI_UNLINK, 212);
  setting_button(s_settings, "Back", UI_BACK, 300);
  lv_obj_add_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
}

// ---- public ------------------------------------------------------------------

void ui_start(ui_action_cb_t on_action) {
  s_action = on_action;
  media_start(ui_media_ready);
  lvgl_port_lock(0);
  lv_obj_t *scr = lv_screen_active();
  lv_obj_set_style_bg_color(scr, BG, 0);
  s_tiles = lv_tileview_create(scr);
  lv_obj_set_style_bg_opa(s_tiles, LV_OPA_TRANSP, 0);
  lv_obj_set_scrollbar_mode(s_tiles, LV_SCROLLBAR_MODE_OFF);
  for (int i = 0; i < PAGES; i++) {
    lv_dir_t dir = (i > 0 ? LV_DIR_LEFT : 0) | (i < PAGES - 1 ? LV_DIR_RIGHT : 0);
    s_page[i] = lv_tileview_add_tile(s_tiles, i, 0, dir);
    if (i != HOME) make_list_page(i);
  }
  make_home();
  lv_obj_add_event_cb(s_tiles, on_tile, LV_EVENT_VALUE_CHANGED, NULL);

  lv_obj_t *dots = lv_obj_create(scr);
  lv_obj_remove_style_all(dots);
  lv_obj_set_size(dots, 120, 12);
  lv_obj_align(dots, LV_ALIGN_BOTTOM_MID, 0, -22);
  lv_obj_set_flex_flow(dots, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(dots, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(dots, 6, 0);
  for (int i = 0; i < PAGES; i++) {
    s_dots[i] = lv_obj_create(dots);
    lv_obj_remove_style_all(s_dots[i]);
    lv_obj_set_style_radius(s_dots[i], 4, 0);
    lv_obj_set_style_bg_opa(s_dots[i], LV_OPA_COVER, 0);
  }
  set_dots(HOME);
  set_petals(LOGO_PETALS);
  start_spin();
  for (int i = 1; i < PAGES; i++) empty(i, "Loading...");
  talk_start(scr, page_query);
  make_overlays();
  lvgl_port_unlock();
}

void ui_message(const char *title, const char *code, const char *body) {
  lvgl_port_lock(0);
  lv_label_set_text(s_ov_title, title ? title : "Friend Flower");
  lv_label_set_text(s_ov_code, code ? code : "");
  lv_label_set_text(s_ov_body, body ? body : "");
  lv_obj_align(s_ov_body, LV_ALIGN_TOP_MID, 0, code ? 240 : 170);
  lv_obj_remove_flag(s_overlay, LV_OBJ_FLAG_HIDDEN);
  lvgl_port_unlock();
}

void ui_hide_message(void) {
  lvgl_port_lock(0);
  lv_obj_add_flag(s_overlay, LV_OBJ_FLAG_HIDDEN);
  lvgl_port_unlock();
}

void ui_home(void) {
  lvgl_port_lock(0);
  lv_obj_add_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
  chat_close();
  talk_close();
  lv_tileview_set_tile_by_index(s_tiles, HOME, 0, LV_ANIM_ON);
  set_dots(HOME);
  lvgl_port_unlock();
}

void ui_summary(const cJSON *s) {
  char a[160], b[200], d1[16], d2[16];
  const cJSON *nearby = cJSON_GetObjectItem(s, "nearby");
  int count = (int)num(nearby, "count", 0);
  const char *city = ui_str(s, "city");
  bool launched = cJSON_IsTrue(cJSON_GetObjectItem(s, "launched"));

  lvgl_port_lock(0);
  char c[64];
  ui_ascii(city, c, sizeof c);
  if (!city) snprintf(a, sizeof a, "Add your city at friendflower.app");
  else if (!launched) snprintf(a, sizeof a, "No live map in %s yet", c);
  else snprintf(a, sizeof a, "%d nearby in %s", count, c);
  lv_label_set_text(s_count, a);

  clear_list(NEARBY);
  const cJSON *p;
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(nearby, "people")) {
    double mi = num(p, "distance_mi", -1);
    const char *nb = ui_str(p, "neighbourhood");
    int mutual = (int)num(p, "mutual_count", 0);
    int degree = (int)num(p, "degree", 2);
    const char *first = ui_str(p, "first_name") ? ui_str(p, "first_name") : "Someone";
    char dist[24] = "";
    if (mi >= 0) snprintf(dist, sizeof dist, mi < 0.1 ? "here" : "%.1f mi", mi);
    snprintf(a, sizeof a, "%s%s%s", first, dist[0] ? " - " : "", dist);
    char how[32] = "";
    if (degree == 1) snprintf(how, sizeof how, "friend");
    else if (mutual > 0) snprintf(how, sizeof how, "%d friend%s in common", mutual, mutual == 1 ? "" : "s");
    snprintf(b, sizeof b, "%s%s%s", nb ? nb : "", nb && how[0] ? " - " : "", how);
    lv_obj_t *r = photo_row(NEARBY, ui_str(p, "id"), FACE, false, first);
    lv_obj_t *col = column(r);
    lv_obj_set_flex_grow(col, 1);
    texts(col, cJSON_IsTrue(cJSON_GetObjectItem(p, "online")), true, a, b);
  }
  if (!count) empty(NEARBY, launched ? "Nobody nearby right now.\nTurn on Live distance at friendflower.app to see friends of friends here."
                                     : "The live map isn't in your city yet.");

  clear_list(CHATS);
  const cJSON *chats = cJSON_GetObjectItem(s, "chats");
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(chats, "items")) chat_row(p);
  if (!cJSON_GetArraySize(cJSON_GetObjectItem(chats, "items"))) empty(CHATS, "No chats yet.");

  clear_list(TRIPS);
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(s, "trips")) {
    month_day(ui_str(p, "starts_on"), d1, sizeof d1);
    month_day(ui_str(p, "ends_on"), d2, sizeof d2);
    int people = (int)num(p, "people", 0);
    snprintf(a, sizeof a, "%s", ui_str(p, "city") ? ui_str(p, "city") : "Trip");
    snprintf(b, sizeof b, "%s%s - %s - %d friend%s there", cJSON_IsTrue(cJSON_GetObjectItem(p, "now")) ? "Now - " : "",
             d1, d2, people, people == 1 ? "" : "s");
    row(TRIPS, cJSON_IsTrue(cJSON_GetObjectItem(p, "now")), a, b);
  }
  if (!cJSON_GetArraySize(cJSON_GetObjectItem(s, "trips"))) empty(TRIPS, "No trips coming up.\nAdd one at friendflower.app.");

  // Places rarely change: leave the list (and wherever the map is zoomed) alone unless they do.
  const cJSON *places = cJSON_GetObjectItem(s, "places");
  char key[256] = "";
  cJSON_ArrayForEach(p, places) {
    size_t k = strlen(key);
    snprintf(key + k, sizeof key - k, "%.8s%d", ui_str(p, "id") ? ui_str(p, "id") : "?", (int)num(p, "regulars", 0));
  }
  snprintf(key + strlen(key), sizeof key - strlen(key), "%d", launched);
  if (strcmp(key, s_places_key)) {
    snprintf(s_places_key, sizeof s_places_key, "%s", key);
    clear_list(PLACES);
    if (cJSON_GetArraySize(places)) map_card(key);
    int n = 0;
    cJSON_ArrayForEach(p, places) {
      int walk = (int)num(p, "walk_min", -1), regulars = (int)num(p, "regulars", 0);
      const char *nb = ui_str(p, "neighbourhood");
      snprintf(a, sizeof a, "%d  %s", ++n, ui_str(p, "name") ? ui_str(p, "name") : "");
      snprintf(b, sizeof b, "%s%s%s", ui_str(p, "kind") ? ui_str(p, "kind") : "", nb ? " - " : "", nb ? nb : "");
      if (walk >= 0) snprintf(b + strlen(b), sizeof b - strlen(b), " - %d min walk", walk);
      if (regulars) snprintf(b + strlen(b), sizeof b - strlen(b), " - %d of your circle go%s", regulars, regulars == 1 ? "es" : "");
      row(PLACES, false, a, b);
    }
    if (!cJSON_GetArraySize(places))
      empty(PLACES, launched ? "No places yet.\nAdd your spots at friendflower.app." : "Places come with the live map.");
  }
  lvgl_port_unlock();
}
