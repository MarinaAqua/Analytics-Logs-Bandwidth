// Worker Cloudflare untuk Analytics by Country (Multi-Domain)
const CONFIG = {
  email: "YOUR_EMAIL_CLOUDFRALE",
  apiKey: "YOUR_APIKEY_GLOBAL",
  accountId: "YOUR_ACCOUNT_ID",
  zoneIds: [
    "YOUR_ZONE_ID_DOMAIN_1",
    "YOUR_ZONE_ID_DOMAIN_2",
    "YOUR_ZONE_ID_DOMAIN_3"
  ] // Ganti dengan Zone ID domain Anda/ Bisa Ditambah
};

export default {
  async fetch(request, env) {
    // Handle CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    try {
      const results = await getMultiDomainCountryAnalytics(CONFIG);
      return new Response(JSON.stringify(results, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        details: err.message,
        timestamp: new Date().toISOString()
      }), { status: 500 });
    }
  }
};

// Helper functions
function formatBandwidth(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatNumber(num) {
  if (!num) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function fetchGraphQL(email, apiKey, query, variables = {}) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Email': email,
      'X-Auth-Key': apiKey
    },
    body: JSON.stringify({ query, variables })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
  }
  
  const data = await response.json();
  
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  
  return data;
}

async function getMultiDomainCountryAnalytics(config) {
  const { email, apiKey, zoneIds } = config;
  const now = new Date();
  const startDate = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
  const since = startDate.toISOString();
  const until = now.toISOString();
  
  const countryMap = new Map();
  let totalRequests = 0;
  let totalBandwidth = 0;

  // Loop melalui semua zone IDs
  for (const zoneId of zoneIds) {
    const query = `
      query GetCountryAnalytics($zoneTag: String!, $since: String!, $until: String!) {
        viewer {
          zones(filter: {zoneTag: $zoneTag}) {
            httpRequests1hGroups(
              limit: 10000,
              filter: {
                datetime_geq: $since,
                datetime_lt: $until
              }
            ) {
              sum {
                countryMap {
                  requests
                  bytes
                  key: clientCountryName
                }
              }
            }
          }
        }
      }
    `;

    const variables = { zoneTag: zoneId, since, until };

    try {
      const data = await fetchGraphQL(email, apiKey, query, variables);
      const zones = data.data?.viewer?.zones;
      
      if (!zones || zones.length === 0) continue;

      const groups = zones[0]?.httpRequests1hGroups || [];
      
      groups.forEach(group => {
        const countries = group.sum?.countryMap || [];
        
        countries.forEach(country => {
          const countryCode = country.key || "UNKNOWN";
          const requests = country.requests || 0;
          const bandwidth = country.bytes || 0;
          
          totalRequests += requests;
          totalBandwidth += bandwidth;
          
          if (countryMap.has(countryCode)) {
            const existing = countryMap.get(countryCode);
            countryMap.set(countryCode, {
              requests: existing.requests + requests,
              bandwidth: existing.bandwidth + bandwidth
            });
          } else {
            countryMap.set(countryCode, { requests, bandwidth });
          }
        });
      });
    } catch (err) {
      console.error(`Error processing zone ${zoneId}: ${err.message}`);
    }
  }

  // Format hasil
  const countries = Array.from(countryMap, ([country, data]) => ({
    country,
    requests: formatNumber(data.requests),
    bandwidth: formatBandwidth(data.bandwidth),
    raw_requests: data.requests,
    raw_bandwidth: data.bandwidth
  }));

  // Urutkan berdasarkan request terbanyak
  countries.sort((a, b) => b.raw_requests - a.raw_requests);

  return {
    meta: {
      period: {
        since: since,
        until: until,
        days: 3
      },
      total_domains: zoneIds.length,
      total_countries: countries.length,
      last_updated: new Date().toISOString()
    },
    totals: {
      requests: formatNumber(totalRequests),
      bandwidth: formatBandwidth(totalBandwidth),
      raw_requests: totalRequests,
      raw_bandwidth: totalBandwidth
    },
    countries: countries.map(c => ({
      country: c.country,
      requests: c.requests,
      bandwidth: c.bandwidth
    }))
  };
}
