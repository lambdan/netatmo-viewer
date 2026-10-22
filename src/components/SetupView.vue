<script setup lang="ts">
import { reactive, ref } from "vue";
import type { SetupRequest, SetupStatus } from "../../shared/types.ts";

defineProps<{ status: SetupStatus; error?: string }>();
const emit = defineEmits<{ done: [] }>();

const form = reactive<SetupRequest>({ clientId: "", clientSecret: "", refreshToken: "" });
const busy = ref(false);
const message = ref<string>();

async function submit() {
  busy.value = true;
  message.value = undefined;
  try {
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    emit("done");
  } catch (e) {
    message.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="setup">
    <div class="panel">
      <template v-if="status.fromEnv">
        <h1>Netatmo rejected the login</h1>
        <p>
          The credentials in the server's environment variables no longer work. Update
          <code>NETATMO_CLIENT_ID</code>, <code>NETATMO_CLIENT_SECRET</code> and
          <code>NETATMO_REFRESH_TOKEN</code> and restart the container.
        </p>
        <p v-if="error" class="error">{{ error }}</p>
      </template>

      <template v-else>
        <h1 v-if="status.state === 'required'">Connect your weather station</h1>
        <h1 v-else>Netatmo rejected the login</h1>
        <p v-if="status.state === 'rejected'">
          The saved login no longer works (the token may have been revoked). Enter it again below.
        </p>

        <ol>
          <li>
            Log in at <a href="https://dev.netatmo.com/apps" target="_blank">dev.netatmo.com/apps</a>
            with your Netatmo account and <b>create an app</b> (any name and description).
          </li>
          <li>Copy the app's <b>client ID</b> and <b>client secret</b>.</li>
          <li>
            Under <b>Token generator</b>, choose the scope <code>read_station</code>, click
            <b>Generate Token</b> and copy the <b>refresh token</b>.
          </li>
        </ol>
        <p class="hint">Tip: this is easier from a computer. Open this same address there.</p>

        <form @submit.prevent="submit">
          <label>
            <span>Client ID</span>
            <input v-model="form.clientId" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </label>
          <label>
            <span>Client secret</span>
            <input
              v-model="form.clientSecret"
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <label>
            <span>Refresh token</span>
            <input
              v-model="form.refreshToken"
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <p v-if="message" class="error">{{ message }}</p>
          <button type="submit" :disabled="busy">{{ busy ? "Checking with Netatmo…" : "Connect" }}</button>
        </form>
        <p class="hint">
          The credentials are stored in the server's database and are only used to read your
          station's data. Once connected, this form closes.
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.setup {
  min-height: 100%;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  padding: 24px 16px;
}
.panel {
  width: 560px;
  max-width: 100%;
  padding: 28px 32px;
  border-radius: 18px;
  background: var(--card);
  box-shadow: var(--card-shadow);
}
h1 {
  margin: 0 0 14px;
  font-size: 26px;
  font-weight: 500;
}
p,
li {
  font-size: 16px;
  line-height: 1.5;
}
ol {
  margin: 0 0 8px;
  padding-left: 22px;
}
li {
  margin-bottom: 6px;
}
a {
  color: inherit;
}
code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg);
  font-size: 0.9em;
}
.hint {
  font-size: 14px;
  color: var(--muted);
}
form {
  margin: 20px 0 6px;
}
label {
  display: block;
  margin-bottom: 14px;
}
label span {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  color: var(--muted);
}
input {
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  -webkit-appearance: none;
}
button {
  width: 100%;
  margin-top: 6px;
  padding: 13px;
  border: 0;
  border-radius: 12px;
  background: var(--text);
  color: var(--bg);
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  -webkit-appearance: none;
}
button:disabled {
  opacity: 0.6;
}
.error {
  color: var(--warn);
}
</style>
