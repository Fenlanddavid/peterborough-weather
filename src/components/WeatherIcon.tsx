export type IconName = 'sun' | 'moon' | 'cloud' | 'partly-cloudy' | 'cloud-moon' | 'fog' | 'storm' | 'rain' | 'showers' | 'wind' | 'snow' | 'drop' | 'arrow' | 'refresh' | 'pin' | 'calendar' | 'star' | 'eye' | 'telescope';

export function WeatherIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const sun = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>;
  const cloud = <path className="icon-cloud" d="M6 16a4 4 0 0 1-.8-7.9A5.5 5.5 0 0 1 15.7 8 4 4 0 1 1 18 16Z" />;
  return (
    <svg className={`weather-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'sun' && sun}
      {name === 'moon' && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />}
      {name === 'partly-cloudy' && <><circle cx="7" cy="6" r="3.5" className="icon-sun" /><path className="icon-sun" d="M7 1v1M1 6h1m.8-3.2.7.7M11 2l-.7.7" /></>}
      {name === 'cloud-moon' && <path d="M15 2a5 5 0 0 0 6 6 6 6 0 0 1-9-3" />}
      {(name === 'cloud' || name === 'partly-cloudy' || name === 'cloud-moon' || name === 'fog' || name === 'storm') && cloud}
      {name === 'fog' && <path d="M3 19h18M6 22h12" />}
      {name === 'storm' && <path d="m13 15-3 5h4l-2 3" />}
      {(name === 'rain' || name === 'showers') && <>
        {name === 'showers' && <><circle cx="7" cy="7" r="3.5" className="icon-sun" /><path className="icon-sun" d="M7 1v1M1 7h1m.8-4.2.7.7M11 3l-.7.7" /></>}
        <path className="icon-cloud" d="M6 16a4 4 0 0 1-.8-7.9A5.5 5.5 0 0 1 15.7 8 4 4 0 1 1 18 16Z" />
        <path className="icon-rain" d="m8 19-1 2m6-2-1 2m6-2-1 2" />
      </>}
      {name === 'wind' && <path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1-2.5 2.5M4 16h6a3 3 0 1 1-3 3" />}
      {name === 'snow' && <path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9 4l3 3 3-3M9 20l3-3 3 3M3.57 10.6l4.1-1.1-1.1-4.1M17.43 18.4l-1.1-4.1 4.1-1.1M6.57 18.4l1.1-4.1-4.1-1.1M20.43 10.6l-4.1-1.1 1.1-4.1" />}
      {name === 'drop' && <path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Zm-3 12a3 3 0 0 0 3 3" />}
      {name === 'arrow' && <path d="M5 12h14m-5-5 5 5-5 5" />}
      {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6a8 8 0 0 1 13 3L20 12M4 12l.9 3a8 8 0 0 0 13 3" /></>}
      {name === 'pin' && <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>}
      {name === 'calendar' && <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2" /></>}
      {name === 'star' && <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01Z" />}
      {name === 'eye' && <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
      {name === 'telescope' && <><path d="m21 3-6.5 12M7 15l2-4m-5 7 4-8m4 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-4 8v-6l4-2v6" /></>}
    </svg>
  );
}

export function SkyIllustration({ wet = false }: { wet?: boolean }) {
  return (
    <svg className={`sky-illustration ${wet ? 'sky-illustration--wet' : ''}`} viewBox="0 0 320 240" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sun-glow"><stop stopColor="#ffe8a5" stopOpacity=".2" /><stop offset="1" stopColor="#ffe8a5" stopOpacity="0" /></radialGradient>
        <linearGradient id="sun-fill" x1="150" y1="45" x2="205" y2="130" gradientUnits="userSpaceOnUse"><stop stopColor="#ffebba" /><stop offset="1" stopColor="#e6b963" /></linearGradient>
        <linearGradient id="cloud-fill" x1="115" y1="110" x2="180" y2="200" gradientUnits="userSpaceOnUse"><stop stopColor="#eff7ff" /><stop offset="1" stopColor="#9caec5" /></linearGradient>
      </defs>
      <circle cx="183" cy="100" r="115" fill="url(#sun-glow)" />
      <circle cx="183" cy="100" r="74" stroke="#e9d5a4" strokeOpacity=".1" />
      <circle cx="183" cy="100" r="93" stroke="#e9d5a4" strokeOpacity=".06" />
      <circle cx="183" cy="100" r="43" fill="url(#sun-fill)" />
      <path d="M88 183a29 29 0 0 1-2-58 41 41 0 0 1 76-14 32 32 0 0 1 48 27 23 23 0 1 1-1 45Z" fill="url(#cloud-fill)" />
      <path d="M214 147a19 19 0 0 1 0-38 26 26 0 0 1 47-8 20 20 0 0 1 28 18 14 14 0 0 1-2 28Z" fill="#dce7ef" fillOpacity=".55" />
      {wet && <path d="m112 199-5 13m35-13-5 13m35-13-5 13" stroke="#9bcced" strokeWidth="4" strokeLinecap="round" />}
      <path d="M55 104h20m-10-10v20m191 67h12m-6-6v12" stroke="#b6d2e5" strokeOpacity=".5" strokeLinecap="round" />
      <circle cx="243" cy="53" r="2" fill="#dfeaf3" fillOpacity=".6" />
      <circle cx="77" cy="207" r="2" fill="#dfeaf3" fillOpacity=".3" />
    </svg>
  );
}
