export async function onRequest(context) {
  const url = new URL(context.request.url);
  const response = await context.env.ASSETS.fetch(new URL('/cam-am-chi-tiet.html', url.origin));
  return new Response(response.body, {
    status: 200,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate'
    }
  });
}
