<template>
  <div>
    <label>"{{ room }}" is a private room</label>
    <form @submit.prevent="onSubmit">
      <input
        v-model="code"
        type="text"
        name="code"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        placeholder="6-digit access code"
        autocomplete="off"
        required
      />
      <p v-if="error" class="room-code-gate__error">{{ error }}</p>
      <button type="submit">Enter room</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

type RoomCodeGateProps = {
  room: string
  error?: string | null
}

defineProps<RoomCodeGateProps>()
const emit = defineEmits<{ submit: [code: string] }>()

const code = ref('')

/**
 * Doesn't validate the code's shape client-side beyond the input's own
 * `pattern`/`maxlength` - the server is the only source of truth for
 * whether a code is correct (Task 12), so this just forwards whatever
 * was typed and lets a rejection come back as the `error` prop.
 */
const onSubmit = (): void => {
  emit('submit', code.value)
}
</script>
