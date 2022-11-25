export class Message {
  #id;
  #username;
  #text;
  #createdAt;

  static from({ id, username, text, createdAt }) {
    const instance = new Message();

    instance.#id = id;
    instance.#username = username;
    instance.#text = text;
    instance.#createdAt = createdAt;

    return instance;
  }

  get id() {
    return this.#id;
  }

  get username() {
    return this.#username;
  }

  get text() {
    return this.#text;
  }

  get createdAt() {
    return this.#createdAt;
  }

  snapshot() {
    return {
      id: this.id,
      username: this.username,
      text: this.text,
      createdAt: this.createdAt,
    };
  }
}
