// Load the map first; keep listings available if the optional map cannot load.
try {
  window.maplibregl = await import('./vendor/maplibre/maplibre-gl.mjs');
} catch (error) {
  console.error('MapLibre could not load.', error);
}

const application = document.createElement('script');
application.src = new URL('./app.js?v=maplibre-6.9.0', import.meta.url).href;
document.body.append(application);
