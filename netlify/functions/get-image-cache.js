const { getImageCache } = require("./_blobs");

exports.handler = async () => {
  const cache = await getImageCache();
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
    body: JSON.stringify(cache),
  };
};
