import { createApp } from 'vue'
import './style.css'
import './theme.css'
import App from './App.vue'
import { router } from './router'
import { createPinia } from 'pinia'
import { VERSION } from './util/version'
import { Amplify } from 'aws-amplify'
import outputs from "../amplify_outputs.json"

const pinia = createPinia();

createApp(App)
	.use(router)
	.use(pinia)
	.mount('#app');

Amplify.configure(outputs);