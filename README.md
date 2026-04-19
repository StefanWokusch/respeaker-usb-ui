# ReSpeaker USB UI

Desktop control panel for the `ReSpeaker XVF3800` USB mic array.

This app wraps the full `xvf_host.exe` command surface in a modern Windows UI with live beam visualization, routing controls, DSP tuning, LED control, and direct access to device actions such as save, clear, and reboot.

## Features

- Live `Room` / `Fixed` beam control
- Visual DOA / beam preview
- Mic, AGC, noise, echo, and routing controls
- LED ring controls with live preview
- Raw expert access to the full `xvf_host` command catalog
- Direct device actions for `SAVE_CONFIGURATION`, `CLEAR_CONFIGURATION`, and `REBOOT`

## Stack

- `Electron`
- `React`
- `Vite`

The app is Windows-first today, but the code structure does not block Linux support later.

## Platform Support

- `Windows`: supported
- `Linux`: not supported yet
- `macOS`: not supported yet

Linux and macOS are intentionally not claimed as supported in the current releases because the app still depends on a Windows-shaped `xvf_host.exe` workflow and has not been validated there.

## Device Dependency

This app does **not** contain the XVF3800 control binary itself.

You still need `xvf_host.exe` from the official ReSpeaker XVF3800 firmware / host control package. The app tries to auto-detect a repo-relative layout like:

```text
hardware/respeaker-xvf3800/work/reSpeaker_XVF3800_USB_4MIC_ARRAY/host_control/win32/xvf_host.exe
```

If auto-detection does not find it, choose the executable manually in the app via `System`.

## Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Windows Packages

```powershell
npm run dist:win
```

This generates Windows distributables in `release/`:

- NSIS installer `.exe`
- portable `.exe`

## GitHub Releases

The repository includes a GitHub Actions workflow that builds Windows binaries.

- `workflow_dispatch`: build and upload artifacts
- tag push like `v0.1.0`: build and attach `.exe` files to a GitHub Release

Because the binaries are unsigned, Windows SmartScreen may warn on first launch.

## Notes

- Device commands are executed serially on purpose because parallel `xvf_host` access can break communication with the board.
- The expert view does not poll every command continuously. It reads values on demand.
- Live preview is optimized around `AEC_AZIMUTH_VALUES` and `AEC_SPENERGY_VALUES`, which are reliable on the current firmware.
- The app intentionally uses a custom technical board illustration instead of shipping an unlicensed product photo.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
