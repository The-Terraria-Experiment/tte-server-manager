import { createApp } from 'vue'
import './style.css'
import './theme.css'
import App from './App.vue'
import { router } from './router'
import { createPinia } from 'pinia'
import alertsPlugin from './plugins/alerts'
import permissionsPlugin from './plugins/permissions'
import { VERSION } from './util/version'
import { Amplify } from 'aws-amplify'
import outputs from "../amplify_outputs.json"
import StatusTile from './components/common/StatusTile.vue'
import Spinner from './components/common/Spinner.vue'
import Icon from './components/common/Icon.vue'
import FlexButton from './components/common/FlexButton.vue'
import NotAllowed from './components/common/NotAllowed.vue'
import ValueInput from './components/common/ValueInput.vue'

const pinia = createPinia();

// Can't find a way to configure Amplify to use the custom Cognito domain, so we override it here
// https://github.com/aws-amplify/amplify-cli/issues/1880#issuecomment-1980860528
if (outputs?.auth?.oauth?.domain && import.meta.env.VITE_DEPLOY_ENV === 'prod') {
	outputs.auth.oauth.domain = "sm.auth.terrariaexperiment.click";
} else if (import.meta.env.VITE_DEPLOY_ENV === 'prod') {
	console.warn("OAuth domain does not exist");
}
if (outputs?.auth?.oauth) {
	outputs.auth.oauth.scopes = ["email", "openid", "profile"];
} else {
	console.warn("Could not set OAuth scopes");
}

Amplify.configure(outputs);

const app = createApp(App);

app
	.use(router)
	.use(pinia)
	.use(alertsPlugin)
	.use(permissionsPlugin)
	.component('StatusTile', StatusTile)
	.component('Spinner', Spinner)
	.component('Icon', Icon)
	.component('FlexButton', FlexButton)
	.component('NotAllowed', NotAllowed)
	.component('ValueInput', ValueInput)
	.mount('#app');