import { I18nProvider } from "./i18n";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Features from "./components/Features";
import Integrations from "./components/Integrations";
import Connect from "./components/Connect";
import Server from "./components/Server";
import Platforms from "./components/Platforms";
import Download from "./components/Download";
import Footer from "./components/Footer";

export default function App() {
  return (
    <I18nProvider>
      <div className="min-h-screen bg-base text-slate-100 antialiased">
        <Navbar />
        <main>
          <Hero />
          <Features />
          <Integrations />
          <Connect />
          <Server />
          <Platforms />
          <Download />
        </main>
        <Footer />
      </div>
    </I18nProvider>
  );
}
