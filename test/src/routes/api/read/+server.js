import wiki from '$lib/server/wiki.js';
import { error, json } from '@sveltejs/kit';

export async function POST({ request, locals }) {
	if (!locals.session) {
		throw error(401, 'Unauthorized');
	}
	let { fullTitle } = await request.json();
	return json(await wiki.readDoc(fullTitle));
}
