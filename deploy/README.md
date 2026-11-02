# Installing steamcouch on Bazzite (Gaming Mode images)

Every push to `main` publishes a release with
`steamcouch-linux-x64.tar.gz`:

```
steamcouch/
  app/                          Electron app (run app/steamcouch)
  steamcouch-session            session client script
  ogui-steam.session-override   gamescope-session-plus hook
  BUILD                         source commit
```

## In a custom image (Containerfile)

```dockerfile
RUN curl -fsSL --retry 3 -o /tmp/steamcouch.tgz \
      https://github.com/SupercaliG/steamcouch/releases/latest/download/steamcouch-linux-x64.tar.gz && \
    mkdir -p /usr/lib/steamcouch && \
    tar -xzf /tmp/steamcouch.tgz -C /usr/lib/steamcouch --strip-components=1 && \
    install -m 0755 /usr/lib/steamcouch/steamcouch-session /usr/libexec/steamcouch-session && \
    install -D -m 0644 /usr/lib/steamcouch/ogui-steam.session-override \
      /etc/gamescope-session-plus/sessions.d/ogui-steam && \
    rm /tmp/steamcouch.tgz
```

The hook replaces the Steam UI with the dashboard in the `ogui-steam`
Gaming Mode session. Steam keeps running in the background.

## Per user

- `~/.config/steamcouch/disable` (empty file): always use Steam Gaming Mode.
- `~/.config/steamcouch/electron-flags`: extra Chromium switches, one per line.
- `~/.config/steamcouch/steamgriddb.key`: SteamGridDB API key for automatic
  art on non-Steam shortcuts (optional).
- `~/.local/share/steamcouch/app/`: a development copy of the app; used instead
  of `/usr/lib/steamcouch/app` when present.
- `~/.local/share/steamcouch/session.log`: session log.
