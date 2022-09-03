import { App, Modal, Setting } from "obsidian";

export class InputModal extends Modal {
  result: string;
  title: string;
  inputLabel: string;
  onSubmit: (result: string) => void;

  constructor(app: App, title: string, inputLabel: string, onSubmit: (result: string) => void) {
    super(app);
    this.title = title;
    this.inputLabel = inputLabel;
    this.onSubmit = onSubmit;
    this.result = "";
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: this.title });

    new Setting(contentEl)
      .setName(this.inputLabel)
      .addText((text) =>
        text.onChange((value) => {
          this.result = value
        }));

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Submit")
          .setCta()
          .onClick(() => {
            this.close();
            if (this.result.length > 0) {
              this.onSubmit(this.result);
            }
          }));
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}