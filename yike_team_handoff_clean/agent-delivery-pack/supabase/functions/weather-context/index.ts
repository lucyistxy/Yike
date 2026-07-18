import { requestHeaders } from "../_shared/supabaseClient.ts";

type WeatherPayload = {
  city?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json() as WeatherPayload;
    const context = await getWeatherContext(payload);
    return json(context);
  } catch (error) {
    return json({
      error: "weather_context_failed",
      message: error instanceof Error ? error.message : "Unknown error",
      weather_tags: []
    }, 200);
  }
});

async function getWeatherContext(payload: WeatherPayload) {
  if (payload.latitude == null || payload.longitude == null) {
    return {
      source: "fallback",
      city: payload.city ?? null,
      weather: null,
      temperature: null,
      rain_probability: null,
      weather_tags: []
    };
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(payload.latitude));
  url.searchParams.set("longitude", String(payload.longitude));
  url.searchParams.set("current", "temperature_2m,precipitation,rain,weather_code");
  url.searchParams.set("timezone", payload.timezone ?? "auto");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`weather_api_failed: ${response.status}`);
  const data = await response.json();
  const current = data.current ?? {};
  const temperature = current.temperature_2m ?? null;
  const rain = current.rain ?? current.precipitation ?? 0;

  return {
    source: "open-meteo",
    city: payload.city ?? null,
    weather: weatherLabel(current.weather_code),
    temperature,
    rain_probability: rain > 0 ? 1 : 0,
    weather_tags: buildWeatherTags(temperature, rain, current.weather_code)
  };
}

function buildWeatherTags(temperature: number | null, rain: number, weatherCode: number | null) {
  const tags: string[] = [];
  if (rain > 0 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(Number(weatherCode))) tags.push("rain");
  if (temperature != null && temperature >= 32) tags.push("hot");
  if (temperature != null && temperature <= 8) tags.push("cold");
  return tags;
}

function weatherLabel(code: number | null) {
  if (code == null) return null;
  if ([0].includes(code)) return "clear";
  if ([1, 2, 3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  return "unknown";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
