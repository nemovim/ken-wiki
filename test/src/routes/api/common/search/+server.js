import { error, json } from '@sveltejs/kit';
import { WikiManager } from 'ken-wiki';

export async function GET({ locals }) {
	if (!locals.session) {
		error(401, 'Unauthorized');
	}
	return json(await WikiManager.getFullTitleArr());
}
