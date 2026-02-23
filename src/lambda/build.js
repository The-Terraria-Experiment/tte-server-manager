#!/usr/bin/env node
/**
 * Build script for Lambda functions
 * Bundles each function with shared dependencies into deployment packages
 */

const fs = require("fs");
const path = require("path");
const {execSync} = require("child_process");

const FUNCTIONS = ["instance-manager", "server-manager", "user-manager", "cognito-user-link", "system-manager", "api-authorizer"];
const BUILD_DIR = path.join(__dirname, "dist");

console.log("Building Lambda functions...\n");

// Clean build directory
if (fs.existsSync(BUILD_DIR)) {
	fs.rmSync(BUILD_DIR, {recursive: true});
}
fs.mkdirSync(BUILD_DIR, {recursive: true});

// Build each function
for (const fn of FUNCTIONS) {
	console.log(`📦 Building ${fn}...`);

	const fnDir = path.join(__dirname, fn);
	const buildFnDir = path.join(BUILD_DIR, fn);

	// Create build directory for function
	fs.mkdirSync(buildFnDir, {recursive: true});

	// Copy function files (exclude shared since we copy it explicitly next)
	copyRecursive(fnDir, buildFnDir, ["node_modules", "package-lock.json", "shared"]);

	// Copy shared utilities
	const sharedSrc = path.join(__dirname, "shared");
	const sharedDest = path.join(buildFnDir, "shared");
	copyRecursive(sharedSrc, sharedDest, ["node_modules", "package-lock.json"]);

	// Merge dependencies from function and shared package.json
	const fnPackage = JSON.parse(fs.readFileSync(path.join(fnDir, "package.json"), "utf8"));
	const sharedPackage = JSON.parse(fs.readFileSync(path.join(sharedSrc, "package.json"), "utf8"));

	fnPackage.dependencies = {
		...sharedPackage.dependencies,
		...fnPackage.dependencies,
	};

	fs.writeFileSync(path.join(buildFnDir, "package.json"), JSON.stringify(fnPackage, null, 2));

	// Install production dependencies
	console.log(`  Installing dependencies...`);
	execSync("npm install --omit=dev", {
		cwd: buildFnDir,
		stdio: "inherit",
	});

	// Create ZIP for deployment
	console.log(`  Creating deployment package...`);
	const zipFile = path.join(BUILD_DIR, `${fn}.zip`);

	// Use zip command (cross-platform)
	execSync(`cd "${buildFnDir}" && zip -r "${zipFile}" .`, {stdio: "inherit"});

	console.log(`✅ ${fn} built: ${zipFile}\n`);
}

console.log("🎉 All functions built successfully!");
console.log(`\nDeployment packages in: ${BUILD_DIR}`);

/**
 * Recursively copy directory (handles symlinks correctly)
 */
function copyRecursive(src, dest, exclude = []) {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, {recursive: true});
	}

	const entries = fs.readdirSync(src, {withFileTypes: true});

	for (const entry of entries) {
		if (exclude.includes(entry.name)) continue;

		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		// Resolve symlinks to their actual targets
		const stats = fs.lstatSync(srcPath);
		
		if (stats.isSymbolicLink()) {
			// Follow the symlink and copy the actual content
			const realPath = fs.realpathSync(srcPath);
			const realStats = fs.statSync(realPath);
			
			if (realStats.isDirectory()) {
				copyRecursive(realPath, destPath, exclude);
			} else {
				fs.copyFileSync(realPath, destPath);
			}
		} else if (entry.isDirectory()) {
			copyRecursive(srcPath, destPath, exclude);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}
