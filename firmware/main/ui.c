// The round screen: swipe left/right between Home, Nearby, Chats, Trips and
// Places. Lists scroll up and down. Hold Home for 3 seconds for settings.
// Setup, the link code and connection problems show full screen on top.
#include <stdio.h>
#include <string.h>
#include "esp_lvgl_port.h"
#include "esp_system.h"
#include "ui.h"

#define W 466
#define PINK lv_color_hex(0xe6a8bd)
#define GREY lv_color_hex(0x9a918c)
#define FAINT lv_color_hex(0x3a352e)
#define BG lv_color_hex(0x0d0c0b)
#define MAX_PETALS 12
#define FLOWER_Y 158
#define PETAL_SCALE 210  // 256 = full size
#define LOGO_PETALS 5    // the five-heart logo
#define SPIN_MS 12000    // one full turn

LV_IMAGE_DECLARE(img_petal);
LV_IMAGE_DECLARE(img_face);

enum { HOME, NEARBY, CHATS, TRIPS, PLACES, PAGES };
static const char *TITLES[PAGES] = { "", "Nearby", "Chats", "Trips", "Places" };

static lv_obj_t *s_tiles, *s_page[PAGES], *s_list[PAGES], *s_dots[PAGES];
static lv_obj_t *s_petals[MAX_PETALS], *s_count, *s_overlay, *s_ov_title, *s_ov_code, *s_ov_body, *s_settings;
static ui_action_cb_t s_action;
static int s_shown;

// ---- text ------------------------------------------------------------------

// The built-in fonts are ASCII only: fold accented letters to plain ones and
// drop anything else that isn't ASCII (emoji, CJK).
static void ascii(const char *in, char *out, size_t len) {
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

static const char *str(const cJSON *o, const char *key) {
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

static lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const char *text) {
  lv_obj_t *l = lv_label_create(parent);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, color, 0);
  lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
  lv_label_set_text(l, text);
  return l;
}

// ---- pages -----------------------------------------------------------------

static void set_dots(int page) {
  for (int i = 0; i < PAGES; i++) {
    lv_obj_set_style_bg_color(s_dots[i], i == page ? PINK : FAINT, 0);
    lv_obj_set_size(s_dots[i], i == page ? 18 : 8, 8);
  }
}

static void on_tile(lv_event_t *e) {
  lv_obj_t *t = lv_tileview_get_tile_active(s_tiles);
  for (int i = 0; i < PAGES; i++) if (s_page[i] == t) set_dots(i);
}

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
  lv_obj_t *title = label(t, &lv_font_montserrat_28, PINK, TITLES[i]);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 42);
  lv_obj_t *list = lv_obj_create(t);
  s_list[i] = list;
  lv_obj_remove_style_all(list);
  lv_obj_set_size(list, 340, 318);
  lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 92);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_flex_align(list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_row(list, 14, 0);
  lv_obj_set_style_pad_bottom(list, 60, 0);
  lv_obj_set_scroll_dir(list, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
  lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLL_ELASTIC);
}

static void clear_list(int i) { lv_obj_clean(s_list[i]); }

static void row(int page, bool dot, const char *head, const char *detail) {
  char a[96], b[200];
  ascii(head, a, sizeof a);
  ascii(detail, b, sizeof b);
  lv_obj_t *r = lv_obj_create(s_list[page]);
  lv_obj_remove_style_all(r);
  lv_obj_set_width(r, lv_pct(100));
  lv_obj_set_height(r, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(r, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_flex_align(r, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_t *h = label(r, &lv_font_montserrat_20, dot ? PINK : lv_color_white(), a);
  lv_label_set_long_mode(h, LV_LABEL_LONG_DOT);
  lv_obj_set_width(h, lv_pct(100));
  if (b[0]) {
    lv_obj_t *d = label(r, &lv_font_montserrat_14, GREY, b);
    lv_label_set_long_mode(d, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(d, lv_pct(100));
  }
}

static void empty(int page, const char *text) {
  lv_obj_t *l = label(s_list[page], &lv_font_montserrat_20, GREY, text);
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

  s_count = label(t, &lv_font_montserrat_20, GREY, "");
  lv_obj_align(s_count, LV_ALIGN_TOP_MID, 0, 278);
  lv_obj_t *q = label(t, &lv_font_montserrat_28, lv_color_white(), "Looking for friends\nof friends?");
  lv_obj_set_style_text_line_space(q, 4, 0);
  lv_obj_align(q, LV_ALIGN_TOP_MID, 0, 314);
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

// ---- overlays ----------------------------------------------------------------

static lv_obj_t *round_layer(void) {
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
  lv_obj_set_style_bg_color(b, a == UI_BACK ? PINK : lv_color_hex(0x1a1816), 0);
  lv_obj_set_style_border_color(b, FAINT, 0);
  lv_obj_set_style_border_width(b, a == UI_BACK ? 0 : 2, 0);
  lv_obj_t *l = label(b, &lv_font_montserrat_20, a == UI_BACK ? BG : lv_color_white(), text);
  lv_obj_center(l);
  lv_obj_add_event_cb(b, on_setting, LV_EVENT_CLICKED, (void *)(intptr_t)a);
}

static void make_overlays(void) {
  s_overlay = round_layer();
  s_ov_title = label(s_overlay, &lv_font_montserrat_28, PINK, "Friend Flower");
  lv_obj_align(s_ov_title, LV_ALIGN_TOP_MID, 0, 110);
  s_ov_code = label(s_overlay, &lv_font_montserrat_40, lv_color_white(), "");
  lv_obj_set_style_text_letter_space(s_ov_code, 8, 0);
  lv_obj_align(s_ov_code, LV_ALIGN_TOP_MID, 0, 170);
  s_ov_body = label(s_overlay, &lv_font_montserrat_20, GREY, "Starting...");
  lv_label_set_long_mode(s_ov_body, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(s_ov_body, 330);
  lv_obj_align(s_ov_body, LV_ALIGN_TOP_MID, 0, 240);

  s_settings = round_layer();
  lv_obj_t *t = label(s_settings, &lv_font_montserrat_28, PINK, "Settings");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 70);
  setting_button(s_settings, "Change Wi-Fi", UI_FORGET_WIFI, 140);
  setting_button(s_settings, "Unlink account", UI_UNLINK, 212);
  setting_button(s_settings, "Back", UI_BACK, 300);
  lv_obj_add_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
}

// ---- public ------------------------------------------------------------------

void ui_start(ui_action_cb_t on_action) {
  s_action = on_action;
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
  lv_tileview_set_tile_by_index(s_tiles, HOME, 0, LV_ANIM_ON);
  set_dots(HOME);
  lvgl_port_unlock();
}

void ui_summary(const cJSON *s) {
  char a[160], b[200], d1[16], d2[16];
  const cJSON *nearby = cJSON_GetObjectItem(s, "nearby");
  int count = (int)num(nearby, "count", 0);
  const char *city = str(s, "city");
  bool launched = cJSON_IsTrue(cJSON_GetObjectItem(s, "launched"));

  lvgl_port_lock(0);
  char c[64];
  ascii(city, c, sizeof c);
  if (!city) snprintf(a, sizeof a, "Add your city at friendflower.app");
  else if (!launched) snprintf(a, sizeof a, "No live map in %s yet", c);
  else snprintf(a, sizeof a, "%d nearby in %s", count, c);
  lv_label_set_text(s_count, a);

  clear_list(NEARBY);
  const cJSON *p;
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(nearby, "people")) {
    double mi = num(p, "distance_mi", -1);
    const char *nb = str(p, "neighbourhood");
    int mutual = (int)num(p, "mutual_count", 0);
    int degree = (int)num(p, "degree", 2);
    char dist[24] = "";
    if (mi >= 0) snprintf(dist, sizeof dist, mi < 0.1 ? "here" : "%.1f mi", mi);
    snprintf(a, sizeof a, "%s%s%s", str(p, "first_name") ? str(p, "first_name") : "Someone", dist[0] ? " - " : "", dist);
    char how[32] = "";
    if (degree == 1) snprintf(how, sizeof how, "friend");
    else if (mutual > 0) snprintf(how, sizeof how, "%d friend%s in common", mutual, mutual == 1 ? "" : "s");
    snprintf(b, sizeof b, "%s%s%s", nb ? nb : "", nb && how[0] ? " - " : "", how);
    row(NEARBY, cJSON_IsTrue(cJSON_GetObjectItem(p, "online")), a, b);
  }
  if (!count) empty(NEARBY, launched ? "Nobody nearby right now.\nTurn on Live distance at friendflower.app to see friends of friends here."
                                     : "The live map isn't in your city yet.");

  clear_list(CHATS);
  const cJSON *chats = cJSON_GetObjectItem(s, "chats");
  int unread = (int)num(chats, "unread", 0);
  if (unread) { snprintf(a, sizeof a, "%d unread", unread); row(CHATS, true, a, ""); }
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(chats, "items")) {
    const char *sender = str(p, "sender");
    snprintf(b, sizeof b, "%s%s%s", sender && strcmp(sender, "me") ? sender : "You", ": ", str(p, "body") ? str(p, "body") : "");
    row(CHATS, cJSON_IsTrue(cJSON_GetObjectItem(p, "unread")), str(p, "title") ? str(p, "title") : "Chat", b);
  }
  if (!cJSON_GetArraySize(cJSON_GetObjectItem(chats, "items"))) empty(CHATS, "No chats yet.");

  clear_list(TRIPS);
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(s, "trips")) {
    month_day(str(p, "starts_on"), d1, sizeof d1);
    month_day(str(p, "ends_on"), d2, sizeof d2);
    int people = (int)num(p, "people", 0);
    snprintf(a, sizeof a, "%s", str(p, "city") ? str(p, "city") : "Trip");
    snprintf(b, sizeof b, "%s%s - %s - %d friend%s there", cJSON_IsTrue(cJSON_GetObjectItem(p, "now")) ? "Now - " : "",
             d1, d2, people, people == 1 ? "" : "s");
    row(TRIPS, cJSON_IsTrue(cJSON_GetObjectItem(p, "now")), a, b);
  }
  if (!cJSON_GetArraySize(cJSON_GetObjectItem(s, "trips"))) empty(TRIPS, "No trips coming up.\nAdd one at friendflower.app.");

  clear_list(PLACES);
  cJSON_ArrayForEach(p, cJSON_GetObjectItem(s, "places")) {
    int walk = (int)num(p, "walk_min", -1), regulars = (int)num(p, "regulars", 0);
    const char *nb = str(p, "neighbourhood");
    snprintf(b, sizeof b, "%s%s%s", str(p, "kind") ? str(p, "kind") : "", nb ? " - " : "", nb ? nb : "");
    if (walk >= 0) snprintf(b + strlen(b), sizeof b - strlen(b), " - %d min walk", walk);
    if (regulars) snprintf(b + strlen(b), sizeof b - strlen(b), " - %d of your circle go%s", regulars, regulars == 1 ? "es" : "");
    row(PLACES, false, str(p, "name"), b);
  }
  if (!cJSON_GetArraySize(cJSON_GetObjectItem(s, "places")))
    empty(PLACES, launched ? "No places yet.\nAdd your spots at friendflower.app." : "Places come with the live map.");
  lvgl_port_unlock();
}
