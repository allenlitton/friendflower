# Friend Flower on the round device

Firmware for the round 466×466 AMOLED device (ESP32-S3, CO5300 screen, CST816S
touch; a Waveshare ESP32-S3-Touch-AMOLED-1.75-style board). It replaces the
Harness firmware and runs Friend Flower on its own over Wi-Fi.

- **Wi-Fi:** with no network saved it opens a "Friend Flower Setup" hotspot; join it
  from a phone and pick your network (`main/net.c`).
- **Account:** it shows a 6-letter code; type it at friendflower.app/device
  (`main/api.c`, `app/api/device/*`, `supabase/migrations/20261017000022_devices.sql`).
- **Screens:** swipe between Home (one petal per nearby person), Nearby, Chats,
  Trips and Places; hold Home 3 s for settings; the BOOT button goes Home (`main/ui.c`).

## Build and flash

Needs ESP-IDF 5.4 (`~/esp/esp-idf`, installed with `./install.sh esp32s3`).

```sh
source ~/esp/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem101 flash monitor
```

Harness holds the USB port while it runs: `harness stop` first, `harness start` after.
The flower images are generated: `tools/build_assets.sh` redraws them into `main/img_*.c`.
