#pragma once
#include <stdbool.h>

typedef enum {
  NET_SETUP,         // hotspot open, waiting for a phone (detail: why, or NULL)
  NET_JOINING,       // trying the saved network (detail: its name)
  NET_ONLINE,
  NET_RECONNECTING,  // was online, lost it, retrying
} net_state_t;

typedef void (*net_state_cb_t)(net_state_t state, const char *detail);

void net_start(net_state_cb_t cb);
bool net_online(void);
void net_forget(void);  // erase the saved network (takes effect on restart)
