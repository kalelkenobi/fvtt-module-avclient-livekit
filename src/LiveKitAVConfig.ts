import { DeepPartial } from "fvtt-types/utils";
import { MODULE_NAME } from "./utils/constants";
import { Logger } from "./utils/logger.js";

const log = new Logger("LiveKitAVConfig");

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

        // Put the data into the partContext
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (partContext as any).liveKitConnectionSettings =
          liveKitConnectionSettings;
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

          if (setting.key === "secondaryAudioSrc") {
            const audioSources = (await game.webrtc?.client.getAudioSources()) ?? {};
            audioSources.disabled = "disabled";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            (data.field as any).choices = audioSources;
          }

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
}