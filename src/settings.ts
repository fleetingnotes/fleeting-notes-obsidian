import { App, PluginSettingTab, Setting, TextAreaComponent } from "obsidian";
import FleetingNotesPlugin from "./main";

export interface FleetingNotesSettings {
	auto_generate_title;
	fleeting_notes_folder: string;
	note_template: string;
	sync_type: string;
	notes_filter: string;
	sync_on_startup: boolean;
	last_sync_time: Date;
	username: string;
	password: string;
	encryption_key: string;
	sync_interval: NodeJS.Timer | undefined;
}

export const DEFAULT_SETTINGS: FleetingNotesSettings = {
	auto_generate_title: false,
	fleeting_notes_folder: "FleetingNotesApp",
	note_template:
		'---\n# Metadata used for sync\nid: "${id}"\ntitle: "${title}"\nsource: "${source}"\ncreated_date: "${created_date}"\nmodified_date: "${last_modified_date}"\n---\n${content}',
	sync_on_startup: false,
	last_sync_time: new Date(0),
	sync_type: "one-way",
	notes_filter: "",
	username: "",
	password: "",
	encryption_key: "",
	sync_interval: undefined,
};

export class FleetingNotesSettingsTab extends PluginSettingTab {
	plugin: FleetingNotesPlugin;

	constructor(app: App, plugin: FleetingNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		let noteTemplateComponent: TextAreaComponent;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Authentication" });

		new Setting(containerEl)
			.setName("Email")
			.setDesc("Email used to log into Fleeting Notes")
			.addText((text) =>
				text
					.setPlaceholder("Enter email")
					.setValue(this.plugin.settings.username)
					.onChange(async (value) => {
						this.plugin.settings.username = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("Password used to log into Fleeting Notes")
			.addText((text) => {
				text.setPlaceholder("Enter password")
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Encryption key")
			.setDesc("Encryption key used to encrypt notes")
			.addText((text) => {
				text.setPlaceholder("Enter encryption key")
					.setValue(this.plugin.settings.encryption_key)
					.onChange(async (value) => {
						this.plugin.settings.encryption_key = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		containerEl.createEl("h2", { text: "Sync Settings" });

		new Setting(containerEl)
			.setName("Fleeting Notes folder location")
			.setDesc("Files will be populated here from Fleeting Notes")
			.addText((text) =>
				text
					.setPlaceholder("Enter the folder location")
					.setValue(this.plugin.settings.fleeting_notes_folder)
					.onChange(async (value) => {
						this.plugin.settings.fleeting_notes_folder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Notes filter text")
			.setDesc(
				"Notes will only be imported if the title/content includes the text"
			)
			.addText((text) =>
				text
					.setPlaceholder("ex. #work")
					.setValue(this.plugin.settings.notes_filter)
					.onChange(async (value) => {
						this.plugin.settings.notes_filter = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sync notes automatically")
			.setDesc("Sync will be performed on startup and every 30 minutes")
			.addToggle((tog) =>
				tog
					.setValue(this.plugin.settings.sync_on_startup)
					.onChange(async (val) => {
						this.plugin.settings.sync_on_startup = val;
						if (val) {
							this.plugin.autoSync();
						} else {
							this.plugin.disableAutoSync();
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Sync type:").addDropdown((dropdown) =>
			dropdown
				.addOption("one-way", "One-way sync (FN ⇒ Obsidian)")
				.addOption(
					"one-way-delete",
					"One-way sync (FN ⇒ Obsidian) + Delete from FN"
				)
				.addOption("two-way", "Two-way sync (FN ⇔ Obsidian)")
				.setValue(this.plugin.settings.sync_type)
				.onChange(async (value) => {
					this.plugin.settings.sync_type = value;
					if (noteTemplateComponent) {
						if (value == "two-way") {
							this.plugin.settings.note_template =
								DEFAULT_SETTINGS.note_template;
							noteTemplateComponent.setValue(
								DEFAULT_SETTINGS.note_template
							);
							noteTemplateComponent.inputEl.setAttr(
								"disabled",
								true
							);
						} else {
							noteTemplateComponent.inputEl.removeAttribute(
								"disabled"
							);
						}
					}
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("Note Template")
			.setDesc("Only editable in one-way sync");
		new Setting(containerEl)
			.setHeading()
			.addTextArea((t) => {
				noteTemplateComponent = t;
				t.setValue(this.plugin.settings.note_template).onChange(
					async (val) => {
						this.plugin.settings.note_template = val;
						await this.plugin.saveSettings();
					}
				);
				t.inputEl.setAttr("rows", 10);
				t.inputEl.addClass("note_template");
				if (this.plugin.settings.sync_type == "two-way") {
					t.inputEl.setAttr("disabled", true);
				}
			})
			.addExtraButton((cb) => {
				cb.setIcon("sync")
					.setTooltip("Refresh template")
					.onClick(() => {
						this.plugin.settings.note_template =
							DEFAULT_SETTINGS.note_template;
						this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Auto-generate note title")
			.setDesc("Will generate based on note content")
			.addToggle((tog) =>
				tog
					.setValue(this.plugin.settings.sync_on_startup)
					.onChange(async (val) => {
						this.plugin.settings.sync_on_startup = val;
						val
							? (this.plugin.settings.auto_generate_title = true)
							: (this.plugin.settings.auto_generate_title =
									false);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Copy Links to Clipboard")
			.setDesc("Copy all Obsidian links to your clipboard")
			.addButton((button) => {
				button
					.setTooltip("Copy links to clipboard")
					.setIcon("copy")
					.onClick(() => {
						const allLinks = this.plugin.getAllLinks();
						const allLinksStr = allLinks
							.map((link) => `[[${link}]]`)
							.join(" ");
						navigator.clipboard.writeText(allLinksStr);
					});
			});
	}
}
