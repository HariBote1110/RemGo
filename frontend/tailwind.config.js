/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                premium: {
                    light: '#f8fafc',
                    dark: '#010409',
                    card: '#0d1117',
                    accent: '#2f81f7',
                },
                glass: {
                    white: 'rgba(255, 255, 255, 0.05)',
                    black: 'rgba(0, 0, 0, 0.4)',
                }
            },
            backgroundImage: {
                'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
            }
        },
    },
    plugins: [],
}
