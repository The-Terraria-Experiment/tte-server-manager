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
// Registers Amplify's OAuth completion listener on the entry chunk. This import is normally
// pulled in as a side effect of `signInWithRedirect`, which only Login.vue reaches - and since
// the routes became dynamic imports, Login.vue's chunk isn't loaded on the pages that need it.
// Two things break without it, both because the hosted-UI callback lands on "/" (getRedirectUrl
// matches the bare-domain entry in redirect_sign_in_uri, not "/login") where that chunk never
// loads: (1) the ?code= is never exchanged for tokens, so federated sign-in silently never
// completes; (2) the `inflightOAuth` localStorage flag set before the redirect is never cleared,
// and TokenOrchestrator.waitForInflightOAuth blocks getCurrentUser/fetchAuthSession on a promise
// only this listener can resolve - no network call, no error, no timeout. That deadlocks the
// router guard's loadUser() before it can redirect to /login, so the one chunk that would clear
// the flag can never load. Recovery was deleting the key by hand.
import "aws-amplify/auth/enable-oauth-listener"
import outputs from "../amplify_outputs.json"
import StatusTile from './components/common/StatusTile.vue'
import Spinner from './components/common/Spinner.vue'
import Icon from './components/common/Icon.vue'
import FlexButton from './components/common/FlexButton.vue'
import NotAllowed from './components/common/NotAllowed.vue'
import ValueInput from './components/common/ValueInput.vue'
import screen from './mixins/screen'

const pinia = createPinia();

// Can't find a way to configure Amplify to use the custom Cognito domain, so we override it here
// https://github.com/aws-amplify/amplify-cli/issues/1880#issuecomment-1980860528
if (outputs?.auth?.oauth?.domain && import.meta.env.VITE_DEPLOY_ENV === 'prod') {
	outputs.auth.oauth.domain = "sm.auth.theterrariaexperiment.com";
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
	.mixin(screen)
	.component('StatusTile', StatusTile)
	.component('Spinner', Spinner)
	.component('Icon', Icon)
	.component('FlexButton', FlexButton)
	.component('NotAllowed', NotAllowed)
	.component('ValueInput', ValueInput)
	.mount('#app');