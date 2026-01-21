import { DeepPartial } from "fvtt-types/utils";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { delayReload } from "./utils/helpers";
import { Logger } from "./utils/logger.js";
import {
  getAuthUserInfo,
  TavernApiErrorResponse,
  ValidatedUser,
} from "./utils/auth.js";

const log = new Logger("LiveKitAVConfig");

interface PatreonLoginEvent extends MessageEvent {
  id: string;
}

export default class LiveKitAVConfig
  extends foundry.applications.settings.menus.AVConfig
{
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "av-config",
    window: {
      title: "WEBRTC.Title",
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-headset",
    },
    position: {
      width: 576,
    },
    form: {
      closeOnSubmit: true,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      handler: LiveKitAVConfig.#onSubmit,
    },
  };

  /** @override */
  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    general: { template: "templates/settings/menus/av-config/general.hbs" },
    devices: { template: "templates/settings/menus/av-config/devices.hbs" },
    server: { template: "modules/avclient-livekit/templates/server.hbs" },
    livekit: { template: "modules/avclient-livekit/templates/livekit.hbs" },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  /** @override */
  static TABS = {
    main: {
      tabs: [
        { id: "general", icon: "fa-solid fa-gear", cssClass: "" },
        { id: "devices", icon: "fa-solid fa-microphone", cssClass: "" },
        { id: "server", icon: "fa-solid fa-server", cssClass: "" },
        { id: "livekit", icon: "fa-solid fa-cogs", cssClass: "" },
      ],
      initial: "general",
      labelPrefix: "WEBRTC.TABS",
    },
  };

  /** @override */
  async _preparePartContext(
    partId: string,
    context: foundry.applications.api.ApplicationV2.RenderContextOf<this>,
    options: DeepPartial<foundry.applications.api.HandlebarsApplicationMixin.RenderOptions>,
  ): Promise<foundry.applications.api.ApplicationV2.RenderContextOf<this>> {
    const partContext = await super._preparePartContext(
      partId,
      context,
      options,
    );
    switch (partId) {
      case "server": {
        const liveKitConnectionSettings = game.settings?.get(
          MODULE_NAME,
          "liveKitConnectionSettings",
        );

        if (!liveKitConnectionSettings) {
          log.error("Unable to get liveKitConnectionSettings");
        }

        const serverTypes =
          game.webrtc?.client._liveKitClient.liveKitServerTypes;

        let authResponse: ValidatedUser | TavernApiErrorResponse | undefined;

        if (game.user?.isGM) {
          const authServer = game.settings.get(MODULE_NAME, "authServer");
          const token = game.settings.get(MODULE_NAME, "tavernPatreonToken");

          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          (partContext as any).tavernPatreonToken = token;

          if (
            liveKitConnectionSettings?.serverType === "tavern" &&
            authServer &&
            authServer != "" &&
            token &&
            token != ""
          ) {
            authResponse = await getAuthUserInfo(authServer, token);
          }
        }

        // Put the data into the partContext
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).liveKitConnectionSettings =
          liveKitConnectionSettings;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).serverTypes = serverTypes;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).authResponse = authResponse;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).devMode = game.settings?.get(
          MODULE_NAME,
          "devMode",
        );

        break;
      }
      case "livekit": {
        const liveKitSettings = [];
        const canConfigure = game.user?.can("SETTINGS_MODIFY");
        for (const setting of game.settings?.settings.values() ?? []) {
          if (
            setting.namespace !== MODULE_NAME ||
            !setting.config ||
            (!canConfigure && setting.scope === "world") ||
            !setting.type
          )
            continue;

          const data = {
            label: setting.key,
            value: game.settings?.get(
              setting.namespace,
              setting.key as foundry.helpers.ClientSettings.KeyFor<"avclient-livekit">,
            ),
            menu: false,
            field: setting.type as unknown as foundry.data.fields.DataField,
          };

          data.field.name = `${setting.namespace}.${setting.key}`;
          data.field.label ||= game.i18n?.localize(setting.name ?? "") ?? "";
          data.field.hint ||= game.i18n?.localize(setting.hint ?? "") ?? "";

          liveKitSettings.push(data);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).liveKitSettings = liveKitSettings;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).isGM = game.user?.isGM ?? false;
        break;
      }
    }

    return partContext;
  }

  async _patreonLogout(authServer: string) {
    // GM only
    if (!game.user?.isGM) return;

    let tavernPatreonToken = game.settings.get(
      MODULE_NAME,
      "tavernPatreonToken",
    );

    const response = await fetch(`${authServer}/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: tavernPatreonToken }),
    });
    if (!response.ok) {
      ui.notifications?.error(`${LANG_NAME}.liveKitAccountLogoutError`, {
        localize: true,
      });
      log.warn("Error signing out of Patreon account", response);
    }

    tavernPatreonToken = "";
    await game.settings.set(
      MODULE_NAME,
      "tavernPatreonToken",
      tavernPatreonToken,
    );
    delayReload();
  }

  async _patreonLoginListener(messageEvent: MessageEvent<PatreonLoginEvent>) {
    // GM only
    if (!game.user?.isGM) return;
    const authServer = game.settings.get(MODULE_NAME, "authServer");
    if (messageEvent.origin !== authServer) return;

    messageEvent.preventDefault();

    const tavernPatreonToken = messageEvent.data.id;

    await game.settings.set(
      MODULE_NAME,
      "tavernPatreonToken",
      tavernPatreonToken,
    );
    delayReload();
  }

  /** @override */
  async _onRender(
    context: foundry.applications.api.ApplicationV2.RenderContextOf<this>,
    options: DeepPartial<foundry.applications.api.HandlebarsApplicationMixin.RenderOptions>,
  ) {
    await super._onRender(context, options);

    const liveKitConnectionSettings = game.settings?.get(
      MODULE_NAME,
      "liveKitConnectionSettings",
    );

    // Activate or de-activate the custom server and tavern patreon sections based on current settings
    this.element
      .querySelector(
        'select[name="avclient-livekit.liveKitConnectionSettings.serverType"]',
      )
      ?.addEventListener("change", (event) => {
        if (!(event.currentTarget instanceof HTMLSelectElement)) return;

        const customFieldset = this.element.querySelector(
          "fieldset[data-custom-server-config]",
        );
        customFieldset?.toggleAttribute(
          "hidden",
          event.currentTarget.value !== "custom",
        );

        const tavernFieldset = this.element.querySelector(
          "fieldset[data-tavern-server-config]",
        );
        tavernFieldset?.toggleAttribute(
          "hidden",
          // This can only be unhidden if the existing server type was also tavern, to avoid the patreon token being set before the server type is set
          event.currentTarget.value !== "tavern" ||
            liveKitConnectionSettings?.serverType !== "tavern",
        );
      });

    // Options below are GM only
    if (!game.user?.isGM) return;
    const authServer = game.settings.get(MODULE_NAME, "authServer");

    if (!authServer || authServer === "") {
      log.error("Auth server is not set");
      return;
    }

    const id = btoa(
      `{"host": "${window.location.hostname}", "world": "${game.world.id}"}`,
    );

    const patreonButton = this.element.querySelector("#tavern-patreon-button");
    if (patreonButton) {
      patreonButton.addEventListener("click", (event: Event) => {
        event.preventDefault();
        window.addEventListener(
          "message",
          (event) => {
            this._patreonLoginListener(event as PatreonLoginEvent).catch(
              (e: unknown) => {
                log.error("Error logging in to Patreon account", e);
              },
            );
          },
          { once: true },
        );
        window.open(
          `${authServer}/auth/patreon?id=${id}&clientRole=participant`,
          undefined,
          "width=600,height=800",
        );

        this._setConfigSectionVisible("#tavern-auth-token", true);
      });
    }

    const logoutButton = this.element.querySelector("#tavern-logout-button");
    if (logoutButton) {
      logoutButton.addEventListener("click", (event: Event) => {
        event.preventDefault();
        this._patreonLogout(authServer).catch((e: unknown) => {
          log.error("Error logging out of Patreon account", e);
        });
      });
    }
  }

  /**
   * Update world and client settings.
   * @this {AVConfig}
   * @type {ApplicationFormSubmission}
   */
  static async #onSubmit(
    _event: Event,
    _form: HTMLFormElement,
    formData: { object: object },
  ) {
    const settings = game.webrtc?.settings;

    if (!settings) {
      log.error("WebRTC settings not found");
      return;
    }

    // @ts-expect-error - expandObject handling is not in foundry-vtt-types to give the proper type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const coreData = foundry.utils.expandObject(formData.object).core;

    // @ts-expect-error - expandObject handling is not in foundry-vtt-types to give the proper type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const liveKitData = foundry.utils.expandObject(formData.object)[
      "avclient-livekit"
    ];

    // Update world settings
    const promises = [];
    if (game.user?.isGM) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const worldUpdates = foundry.utils.mergeObject(
        settings.world,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        coreData.rtcWorldSettings,
        { inplace: false },
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (settings.world.mode !== worldUpdates.mode)
        // @ts-expect-error - reloadConfirm  is not in foundry-vtt-types
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        foundry.applications.settings.SettingsConfig.reloadConfirm({
          world: true,
        });
      promises.push(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        game.settings.set("core", "rtcWorldSettings", worldUpdates),
      );
    }

    // Update client settings
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const clientUpdates = foundry.utils.mergeObject(
      settings.client,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      coreData.rtcClientSettings,
      { inplace: false },
    );
    if (game.settings) {
      promises.push(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        game.settings.set("core", "rtcClientSettings", clientUpdates),
      );
    }

    await Promise.all(promises);

    // Update LiveKit settings
    let requiresClientReload = false;
    let requiresWorldReload = false;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, prefer-const
    for (let [key, value] of Object.entries(liveKitData)) {
      // @ts-expect-error - we need to assume this is a valid setting for now
      const setting = game.settings?.settings.get(`${MODULE_NAME}.${key}`);
      if (!setting) continue;
      // @ts-expect-error - document: true handling is not in foundry-vtt-types
      const priorValue = game.settings?.get(setting.namespace, setting.key, {
        document: true,
      })._source.value;

      if (setting.key === "liveKitConnectionSettings") {
        // We need to handle this one as an object and merge the settings
        const priorValueObject = game.settings?.get(
          // @ts-expect-error - document: true handling is not in foundry-vtt-types
          setting.namespace,
          setting.key,
        );
        // @ts-expect-error - _source handling is not in foundry-vtt-types
        value = foundry.utils.mergeObject(priorValueObject, value, {
          inplace: false,
        });
      }

      let newSetting;
      try {
        newSetting = await game.settings?.set(
          setting.namespace as foundry.helpers.ClientSettings.Namespace,
          setting.key as foundry.helpers.ClientSettings.KeyFor<"avclient-livekit">,
          value as foundry.helpers.ClientSettings.SettingCreateData<
            foundry.helpers.ClientSettings.Namespace,
            foundry.helpers.ClientSettings.KeyFor<"avclient-livekit">
          >,
          { document: true },
        );
      } catch (error) {
        ui.notifications?.error(error as string);
      }
      if (priorValue === newSetting?._source.value) continue; // Compare JSON strings
      requiresClientReload ||=
        (setting.scope !== "world" && setting.requiresReload) ?? false;
      requiresWorldReload ||=
        (setting.scope === "world" && setting.requiresReload) ?? false;
    }
    if (requiresClientReload || requiresWorldReload) {
      // @ts-expect-error - reloadConfirm  is not in foundry-vtt-types
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await foundry.applications.settings.SettingsConfig.reloadConfirm({
        world: requiresWorldReload,
      });
    }
  }

  _setConfigSectionVisible(selector: string, enabled = true) {
    const section = this.element.querySelector(selector);
    if (section) {
      if (enabled) {
        section.classList.remove("hidden");
      } else {
        section.classList.add("hidden");
      }
    }
    this.setPosition(this.position);
  }
}
