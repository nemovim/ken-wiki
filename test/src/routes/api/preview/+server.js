import { error, json } from '@sveltejs/kit';
import { WikiManager } from 'ken-wiki';
import xss from 'xss';

export async function POST({ request, locals }) {
	if (!locals.session) {
		error(401, 'Unauthorized');
	}
	let data = await request.json();
	const markup = xss(data.markup.replaceAll(/\r\n/g, '\n'));
	try {
		return json(await WikiManager.createHTML(markup, data.type, data.categorizedArr));
	} catch (e) {
		return json(e.toString());
	}
}
