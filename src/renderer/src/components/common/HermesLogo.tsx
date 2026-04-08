import icon from "../../assets/icon.png";

function HermesLogo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <img
      src={icon}
      width={size}
      height={size}
      className="rounded-xl"
      alt="Hermes"
    />
  );
}

export default HermesLogo;
