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

// Can't find a way to configure Amplify to use the custom Cognito domain, so we override it here
// https://github.com/aws-amplify/amplify-cli/issues/1880#issuecomment-1980860528
outputs.oauth.domain = "sm.auth.terrariaexperiment.click";

Amplify.configure(outputs);

createApp(App)
	.use(router)
	.use(pinia)
	.mount('#app');