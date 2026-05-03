import { useEffect } from "react";
import splashBg from "../../assets/splash.png";
import splashLogo from "../../assets/splashtext.png";

interface SplashScreenProps {
  onFinished: () => void;
}

function SplashScreen({ onFinished }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    onFinished();
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <img className="splash-bg" src={splashBg} alt="" />
      <img className="splash-logo" src={splashLogo} alt="Hermes Agent" />
    </div>
  );
}

export default SplashScreen;
