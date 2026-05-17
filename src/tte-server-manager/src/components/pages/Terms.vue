<template>
	<div class="flex gap-4 mb-8">
		<h3 class="text-gray-6 font-main font-semibold">On this page:</h3>
		<a href="#privacy_policy">
			<h4 class="font-main font-semibold text-blue-1 cursor-pointer">Privacy Policy</h4>
		</a>
		<a href="#terms_and_conditions">
			<h4 class="font-main font-semibold text-blue-1 cursor-pointer">Terms and Conditions</h4>
		</a>
	</div>

	<div>
		<h1 class="text-4xl font-main font-bold text-teal-4 mb-4" id="privacy_policy">Privacy Policy</h1>
		<h2>Information we collect</h2>
		<p>If you sign in with Google, we collect:</p>
		<ul>
			<li>Your email address</li>
			<li>Your public Google ID</li>
		</ul>
		<p>If you sign in with your email and a password, we collect:</p>
		<ul>
			<li>Your email address</li>
		</ul>
		<p>We also require you to provide a display name of your choosing once you log in. This name is only used so admins can identify you as someone we already know.</p>

		<p>We don't collect any sort of user-identifying data, aside from logging actions taken within the app. Logs include your display name and an ID unique to this app, which can be linked back to the rest of your account for the site.</p>

		<h2>How we use your information</h2>
		<p>We use your email to log you in. We use the display name to identify you in logs and for assigning permissions.</p>
		<p>Logs are kept for a max of 1 month in general, unless we need to hold onto them for security/analysis reasons. But that's rare and only if you're being sketchy.</p>

		<h2>Managing your data</h2>
		<p>If you want your data deleted, contact an admin (specifically @havoc) in the Terraria Experiment discord and we'll get your data cleaned out of our system.</p>
		<p>You can also send an email to <a class="text-blue-1" href="mailto:theterrariexperiment@gmail.com">theterrariexperiment@gmail.com</a> to request that your data is deleted.</p>

		<h2>Cookies and tracking</h2>
		<p>Cookies are used as part of the login process, like nearly all login systems.</p>
		<p>We don't track you. I don't even know how to do that or why that would help me.</p>

		<h2>Security</h2>
		<p>All of your information is encrypted, both while stored and in transit.</p>

		<h2>Contact</h2>
		<p>If you have questions or concerns, you can contact an admin (specifically @havoc) in The Terraria Experiment Discord server, or you can send an email to 
			<a class="text-blue-1" href="mailto:theterrariexperiment@gmail.com">theterrariexperiment@gmail.com</a>.
		</p>

		<h2>Consent</h2>
		<p>By using this site, you consent to the information outlined on this page, as well as ongoing revisions to these terms.</p>
		<p>We will make sure to update our users if we make significant changes to either the privacy policy or the terms of service.</p>
	</div>

	<div>
		<h1 class="text-4xl font-main font-bold text-teal-4 mb-4 mt-16" id="terms_and_conditions">Terms and Conditions</h1>
		<h2>Definitions</h2>
		<p>We, admins: The Terraria Experiment administration group</p>
		<p>The creator: Caleb Dougal</p>
		<p>The service: The Terraria Experiment Server Manager website</p>

		<h2>Consent</h2>
		<p>By using this service, you agree to these terms.</p>

		<h2>Use of the service</h2>
		<p>You agree to use this service as designed as intended by the creator.</p>
		<p>The admins, including the creator, reserve the right to deny use of the service to any individual for any reason or no reason at their sole discretion.</p>
		
		<h2>Prohibited activities</h2>
		<p>If you participate in any of these activities or similar, we reserve the right to bar service to you, both from this service and from The Terraria Experiment community.</p>
		<p>You may not sell access to or use of the service as hosted by The Terraria Experiment group, however, the source code is public and is governed under the GNU GPL 2.0 License.</p>
		<p>You may not use the service to mislead or harm others in any way.</p>
		<p>You may not attempt to circumvent or tamper with the security systems in place.</p>
		<p>You may not use the service to perpetuate malware or other harmful or unwanted content.</p>

		<h2>Your account</h2>
		<p>Please see the Privacy Policy.</p>

		<h2>Uploaded content</h2>
		<p>You may upload content as part of the service. Content must be directly related to Terraria, as interpreted by the creator or admins.</p>
		<p>Uploaded content that is seen as unrelated or harmful in any way may be deleted by admins or others we delegate to.</p>

		<h2>Service management</h2>
		<p>We reserve the right to monitor the service for violations of these terms.</p>
		<p>We refuse liability for consequences to users as a result of violations of these terms.</p>
		
		<h2>Modifications and interruptions</h2>
		<p>We reserve the right to modify these terms at any time or for any reason. If we make changes we deem significant, we will notify our users.</p>
		<p>We reserve the right to modify or discontinue the service at any time for any reason, with or without notice.</p>
		<p>We cannot guarantee the services will be available at all times, or that they will perform their expected function at all times.</p>

		<h2>Dispute resolution</h2>
		<p>If you have a dispute about these terms, or about the service, contact us at <a class="text-blue-1" href="mailto:theterrariexperiment@gmail.com">theterrariexperiment@gmail.com</a>.</p>
	</div>
</template>

<script>

export default {
	mixins: [],
	components: {
		
	},
	props: {
		
	},
	data() {
		return {
			
		}
	},
	computed: {
		
	},
	methods: {
		
	},
}
</script>

<style scoped>
@reference "../../theme.css";

h2 {
	@apply font-main font-bold text-xl text-gray-7 mt-8 mb-2;
}

p, ul {
	@apply font-main font-semibold text-white-0 pl-4 my-2;
}

li {
	@apply list-disc ml-6 mt-2;
}
</style>
