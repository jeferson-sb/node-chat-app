export type MessageProps = {
  id: string;
  username: string;
  text: string;
  createdAt: number;
};

export type MessageSnapshot = MessageProps;

export const MAX_TEXT_LENGTH = 100_000;

export class Message {
  #id: string;
  #username: string;
  #text: string;
  #createdAt: number;

  private constructor(props: MessageProps) {
    this.#id = props.id;
    this.#username = props.username;
    this.#text = props.text;
    this.#createdAt = props.createdAt;
  }

  static from(props: MessageProps): Message {
    if (props.text.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `Message text cannot exceed ${MAX_TEXT_LENGTH} characters`,
      );
    }

    return new Message(props);
  }

  get id(): string {
    return this.#id;
  }

  get username(): string {
    return this.#username;
  }

  get text(): string {
    return this.#text;
  }

  get createdAt(): number {
    return this.#createdAt;
  }

  snapshot(): MessageSnapshot {
    return {
      id: this.id,
      username: this.username,
      text: this.text,
      createdAt: this.createdAt,
    };
  }
}
