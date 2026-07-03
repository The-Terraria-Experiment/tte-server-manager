/**
 * Declarative registry describing the resource-permission hierarchy.
 *
 * Unlike PermissionsMeta (fully static), the *data* here (which instances
 * exist, which path roots each has) is live, sourced from serverStore. Each
 * level is therefore a set of descriptor functions operating on a `context`
 * object (shaped `{ instances, instanceFileRoots }`) rather than a static
 * object literal.
 *
 * To add a new resource type in the future: add one descriptor object,
 * either nested under an existing level's `children` array (a new
 * sub-resource) or as a new top-level entry in `ResourceDefinitions` (a new,
 * unrelated resource domain). No changes are needed to resourceTree.js or
 * ResourcePermissionEditor.vue.
 *
 * Descriptor shape:
 * - key: unique identifier for this level
 * - groupLabel: human-readable heading for this level's items. At the top
 *   level this labels the whole card (e.g. "INSTANCES"); on a nested/child
 *   descriptor it labels the subgroup node wrapping that child's items (e.g.
 *   "Path Roots"), so it's visually clear what kind of resource a checkbox
 *   represents rather than just showing a bare name.
 * - getItems(context, parentItem): returns the list of items at this level
 * - getId(item): stable identifier for an item, used to build node ids
 * - getLabel(item): human-readable label for an item
 * - getOwnTokens(item, parentItem): resource strings granted/revoked when
 *   this item itself (not its descendants) is toggled
 * - ownLabel: label for the synthetic "own access" leaf shown when an item
 *   has both its own tokens and nested children (optional)
 * - children: array of child-level descriptors (optional)
 */
export const ResourceDefinitions = [
	{
		key: 'instance',
		groupLabel: 'INSTANCES',
		getItems: (ctx) => ctx.instances || [],
		getId: (item) => item.id,
		getLabel: (item) => item.name,
		getOwnTokens: (item) => [`instance::${item.id}`, `server::${item.id}`],
		ownLabel: '(Instance Access)',
		children: [
			{
				key: 'pathRoot',
				groupLabel: 'Path Roots',
				getItems: (ctx, parentItem) => Object.keys(ctx.instanceFileRoots?.[parentItem.id] || {}),
				getId: (name) => name,
				getLabel: (name) => name,
				getOwnTokens: (name, parentItem) => [`filepath::${parentItem.id}::${name}`],
			},
		],
	},
];
