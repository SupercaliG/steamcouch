import QRCode from "qrcode";
import { clamp, h, img } from "../dom";
import type { Action } from "../input";
import {
  allProfiles,
  allTitles,
  controllerOnly,
  getProfile,
  refreshAvatars,
  removeAvatar,
  setAllowed,
  setControllerOnly,
  setPin,
  startAvatarUpload,
  stopAvatarUpload,
} from "../store";
import type { Profile, Title, TitleKind } from "../types";
import { pinPad } from "./pin";
import { avatar, toast, type Overlay, type OverlayHost } from "./screen";

interface MenuItem {
  label: string;
  detail?: string;
  icon?: HTMLElement;
  run(): void;
}

/**
 * Settings for grown-ups: what each restricted profile may see, and passcodes.
 * `onChanged` lets the home screen refresh after edits.
 */
export function settingsOverlay(host: OverlayHost, onChanged: () => void): Overlay {
  const body = h("div.settings-body");
  const heading = h("h1.settings-title");
  const el = h("div.overlay.settings", {}, heading, body);

  // A tiny view stack: each view renders into `body` and handles input.
  type View = { render(): void; handle(a: Action): void };
  const views: View[] = [];
  const push = (v: View) => {
    views.push(v);
    v.render();
  };
  const pop = () => {
    views.pop();
    const top = views[views.length - 1];
    if (top) top.render();
    else host.close();
  };

  function menuView(title: string, items: () => MenuItem[]): View {
    let i = 0;
    let rows: HTMLElement[] = [];
    const view: View = {
      render() {
        heading.textContent = title;
        const list = items();
        i = clamp(i, 0, list.length - 1);
        rows = list.map((item) =>
          h(
            "div.settings-row",
            {},
            item.icon ?? null,
            h("div.settings-row-label", {}, item.label),
            item.detail ? h("div.settings-row-detail", {}, item.detail) : null,
            h("div.settings-row-chevron", {}, "›"),
          ),
        );
        body.replaceChildren(h("div.settings-list", {}, ...rows));
        paint();
        view.handle = (a) => {
          if (a === "up") i = clamp(i - 1, 0, list.length - 1);
          else if (a === "down") i = clamp(i + 1, 0, list.length - 1);
          else if (a === "accept") return list[i]!.run();
          else if (a === "back") return pop();
          paint();
        };
      },
      handle() {},
    };
    const paint = () => rows.forEach((r, k) => r.classList.toggle("focused", k === i));
    return view;
  }

  function allowView(profileId: string): View {
    const kinds: { kind: TitleKind; label: string }[] = [
      { kind: "game", label: "Games" },
      { kind: "app", label: "Media Apps" },
    ];
    let k = 0;
    let i = 0;
    let list: Title[] = [];
    let rows: HTMLElement[] = [];
    const listEl = h("div.allow-list");
    const tabsEl = h("div.allow-tabs");

    const build = () => {
      const p = getProfile(profileId);
      list = allTitles()
        .filter((t) => t.kind === kinds[k]!.kind)
        .sort((a, b) => a.name.localeCompare(b.name));
      i = clamp(i, 0, Math.max(0, list.length - 1));
      tabsEl.replaceChildren(
        h("span.lib-hint", {}, "LB"),
        ...kinds.map((x, n) => h(`div.lib-filter${n === k ? ".active" : ""}`, {}, x.label)),
        h("span.lib-hint", {}, "RB"),
      );
      rows = list.map((t) => {
        const on = p.allow.includes(t.id);
        return h(
          `div.allow-row${on ? ".on" : ""}`,
          {},
          thumb(t),
          h(
            "div.allow-name",
            {},
            t.name,
            h("span.allow-source", {}, t.installed ? t.source : `${t.source} · Not installed`),
          ),
          h("div.allow-toggle", {}, h("span.allow-knob")),
        );
      });
      listEl.replaceChildren(...rows);
      paint();
    };
    const paint = () => {
      rows.forEach((r, n) => r.classList.toggle("focused", n === i));
      listEl.style.transform = `translateY(${-Math.max(0, i - 4) * 104}px)`;
    };

    return {
      render() {
        const p = getProfile(profileId);
        heading.textContent = `What ${p.name} can see`;
        body.replaceChildren(
          h(
            "div.allow-head",
            {},
            tabsEl,
            h("div.allow-help", {}, "A turns a title on or off. Off titles are hidden from this profile."),
          ),
          h("div.allow-wrap", {}, listEl),
        );
        build();
      },
      handle(a) {
        if (a === "back") return pop();
        if (a === "tabPrev" || a === "tabNext") {
          k = (k + 1) % kinds.length;
          i = 0;
          return build();
        }
        if (a === "up") i = clamp(i - 1, 0, list.length - 1);
        else if (a === "down") i = clamp(i + 1, 0, list.length - 1);
        else if (a === "accept" && list[i]) {
          const t = list[i]!;
          const now = !getProfile(profileId).allow.includes(t.id);
          setAllowed(profileId, t.id, now);
          onChanged();
          return build();
        }
        paint();
      },
    };
  }

  /**
   * QR code for a phone: scan it, pick a photo, and it becomes this profile's
   * picture. The phone link only works while this view is open.
   */
  function pictureView(profileId: string): View {
    const POLL_MS = 1500;
    let poll: ReturnType<typeof setInterval> | undefined;
    let open = false;
    const preview = h("div.picture-preview");
    const qrBox = h("div.picture-qr");
    const status = h("div.picture-status");

    const paintPreview = () => {
      const p = getProfile(profileId);
      preview.replaceChildren(avatar(p, "picture-avatar"), h("div.picture-name", {}, p.name));
    };

    const leave = () => {
      open = false;
      clearInterval(poll);
      void stopAvatarUpload();
      onChanged();
      pop();
    };

    const view: View = {
      render() {
        heading.textContent = "Profile picture";
        paintPreview();
        if (!open) qrBox.replaceChildren(h("div.spinner"));
        body.replaceChildren(
          h(
            "div.picture-layout",
            {},
            preview,
            h(
              "div.picture-steps",
              {},
              qrBox,
              h(
                "ol.picture-howto",
                {},
                h("li", {}, "Point your phone camera at the code."),
                h("li", {}, "Tap the link, then choose a photo."),
                h("li", {}, "Tap Send to TV."),
              ),
              h("div.picture-note", {}, "Your phone must be on the same Wi-Fi as this TV."),
              status,
            ),
          ),
          h(
            "div.picture-hints",
            {},
            h("span.lib-hint", {}, "Y"),
            " Remove picture    ",
            h("span.lib-hint", {}, "B"),
            " Done",
          ),
        );
        if (open) return;
        open = true;
        status.textContent = "";
        void startAvatarUpload(profileId)
          .then(async (url) => {
            if (!open) return;
            // Generated locally by the qrcode library: plain SVG markup, no user content.
            qrBox.innerHTML = await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
          })
          .catch((err: unknown) => {
            qrBox.replaceChildren(h("div.picture-error", {}, "Can't share right now"));
            status.textContent = err instanceof Error ? err.message : String(err);
          });
        poll = setInterval(async () => {
          if (await refreshAvatars()) {
            paintPreview();
            toast(`New picture for ${getProfile(profileId).name}`);
          }
        }, POLL_MS);
      },
      handle(a) {
        if (a === "back" || a === "accept") return leave();
        if (a === "options") {
          void removeAvatar(profileId).then(() => {
            paintPreview();
            toast("Picture removed");
          });
        }
      },
    };
    return view;
  }

  function passcodeView(profileId: string): View {
    return menuView(`${getProfile(profileId).name} passcode`, () => {
      const p = getProfile(profileId);
      const items: MenuItem[] = [
        { label: p.pin ? "Change passcode" : "Set a passcode", run: () => askNewPin(p) },
      ];
      if (p.pin) {
        items.push({
          label: "Remove passcode",
          run: () => {
            setPin(p.id, undefined);
            toast(`Passcode removed from ${p.name}`);
            views[views.length - 1]?.render();
          },
        });
      }
      return items;
    });
  }

  function askNewPin(p: Profile) {
    let first = "";
    const pad = pinPad({
      title: `New passcode for ${p.name}`,
      subtitle: "Pick 4 numbers",
      onCancel: () => host.close(),
      onDone: (pin) => {
        if (!first) {
          first = pin;
          pad.reset("Enter it again to confirm");
          return;
        }
        if (pin !== first) {
          first = "";
          pad.reset("They did not match. Pick 4 numbers.");
          return;
        }
        setPin(p.id, pin);
        host.close();
        toast(`Passcode set for ${p.name}`);
        views[views.length - 1]?.render();
      },
    });
    host.open(pad);
  }

  push(
    menuView("Settings", () => {
      const profiles = allProfiles();
      const hidden = allTitles().filter((t) => t.kind === "game" && t.controller === false).length;
      return [
        {
          label: "Only show controller games",
          detail: controllerOnly() ? `On · ${hidden} hidden` : "Off",
          run: () => {
            setControllerOnly(!controllerOnly());
            views[views.length - 1]?.render();
          },
        },
        {
          label: "Profile pictures",
          detail: "Send from your phone",
          run: () =>
            push(
              menuView("Profile pictures", () =>
                allProfiles().map(
                  (p): MenuItem => ({
                    label: p.name,
                    detail: p.avatar ? "Change picture" : "Add a picture",
                    icon: avatar(p, "settings-avatar"),
                    run: () => push(pictureView(p.id)),
                  }),
                ),
              ),
            ),
        },
        ...profiles
          .filter((p) => p.restricted)
          .map(
            (p): MenuItem => ({
              label: `Parental controls: ${p.name}`,
              detail: `${p.allow.length} allowed`,
              icon: avatar(p, "settings-avatar"),
              run: () => push(allowView(p.id)),
            }),
          ),
        ...profiles
          .filter((p) => !p.restricted)
          .map(
            (p): MenuItem => ({
              label: `Passcode: ${p.name}`,
              detail: p.pin ? "On" : "Off",
              icon: avatar(p, "settings-avatar"),
              run: () => push(passcodeView(p.id)),
            }),
          ),
      ];
    }),
  );

  return {
    el,
    handle(action) {
      views[views.length - 1]?.handle(action);
    },
  };
}

function thumb(t: Title): HTMLElement {
  const el = h("div.allow-thumb");
  const paint = () => {
    el.replaceChildren(h("span", {}, t.glyph ?? t.name.slice(0, 1)));
    const { from, to } = t.colors ?? { from: "#1f2a48", to: "#4a5b8c" };
    el.style.background = `linear-gradient(140deg, ${from}, ${to})`;
  };
  if (t.art.tile) el.append(img(t.art.tile, "tile-img", paint));
  else paint();
  return el;
}
