<template>
  <section class="centered-form">
    <div class="centered-form__box puff-in-center">
      <h1 class="u-text-center">Join</h1>
      <form @submit.prevent="joinChat">
        <label>Nickname</label>
        <input type="text" name="username" v-model="username" placeholder="Your nickname" required />
        <label>Room</label>
        <input
          type="text"
          name="room"
          v-model="room"
          placeholder="e.g Math, Travel, Academy, ..."
          required
        />
        <button type="submit">Join</button>
      </form>
    </div>
  </section>
</template>

<script>
export default {
  data() {
    return {
      username: '',
      room: ''
    }
  },
  methods: {
    joinChat() {
      this.$router.push(`/chat/${this.username}/${this.room}`)
    }
  }
}
</script>

<style scoped>
.centered-form {
  background-color: var(--bg-color);
  background-image: url('../assets/bg-illustration.svg');
  background-position: center;
  background-size: cover;
  /* width: 100vw; */
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 0 0 1px rgba(32, 34, 37, 0.6), 0 2px 10px 0 rgba(0, 0, 0, 0.2);
}

.centered-form__box {
  border-radius: 5px;
  background: var(--dark-2);
  padding: 40px;
  width: 420px;
  font-size: 18px;
  box-shadow: 0 2px 10px 0 rgba(0, 0, 0, 0.2);
  border-radius: 5px;
}

.centered-form button {
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  line-height: 16px;
  min-height: 40px;
  width: 100%;
}

.centered-form button:hover {
  background: var(--light-purple);
}

.centered-form input {
  margin-bottom: 16px;
  width: 100%;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px solid #0000004d;
  background-color: #0000004d;
  color: var(--white);
}

.centered-form input:focus {
  border-color: var(--purple);
}
.puff-in-center {
  -webkit-animation: puff-in-center 0.7s cubic-bezier(0.47, 0, 0.745, 0.715)
    both;
  animation: puff-in-center 0.7s cubic-bezier(0.47, 0, 0.745, 0.715) both;
}
@keyframes puff-in-center {
  0% {
    -webkit-transform: scale(2);
    transform: scale(2);
    -webkit-filter: blur(2px);
    filter: blur(2px);
    opacity: 0;
  }
  100% {
    -webkit-transform: scale(1);
    transform: scale(1);
    -webkit-filter: blur(0px);
    filter: blur(0px);
    opacity: 1;
  }
}
</style>

