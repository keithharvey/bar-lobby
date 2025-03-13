<template>
    <div class="config-debug">
        <h2>Configuration Debug</h2>
        <div class="actions">
            <button @click="refreshConfig">Refresh Config</button>
            <button @click="copyToClipboard">Copy to Clipboard</button>
        </div>
        <pre class="config-summary">{{ configSummary }}</pre>
        <h3>Full Configuration</h3>
        <pre class="config-json">{{ configJson }}</pre>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from "vue";

const configSummary = ref<string>("Loading...");
const config = ref<any>(null);
const configJson = ref<string>("Loading...");

onMounted(async () => {
    await refreshConfig();
});

async function refreshConfig() {
    try {
        configSummary.value = await window.config.getSummary();
        config.value = await window.config.getConfig();
        configJson.value = JSON.stringify(config.value, null, 2);
    } catch (error) {
        configSummary.value = `Error loading configuration: ${error}`;
        configJson.value = "Failed to load configuration";
    }
}

function copyToClipboard() {
    const text = `Configuration Summary:\n${configSummary.value}\n\nFull Configuration:\n${configJson.value}`;
    navigator.clipboard
        .writeText(text)
        .then(() => alert("Configuration copied to clipboard"))
        .catch((err) => console.error("Failed to copy: ", err));
}
</script>

<style scoped>
.config-debug {
    padding: 20px;
    max-width: 100%;
    overflow: auto;
}

.actions {
    margin-bottom: 15px;
}

button {
    margin-right: 10px;
    padding: 8px 16px;
    background-color: #4a5568;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

button:hover {
    background-color: #2d3748;
}

.config-summary,
.config-json {
    background-color: #1a202c;
    color: #e2e8f0;
    padding: 15px;
    border-radius: 4px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: monospace;
    margin-bottom: 20px;
}
</style>
