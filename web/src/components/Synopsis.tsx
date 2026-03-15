interface SynopsisProps {
  text: string;
  streaming?: boolean;
}

export const Synopsis = ({ text, streaming }: SynopsisProps) => {
  return (
    <section className="section fade-in">
      <h3>Synopsis</h3>
      <p className="synopsis-text">
        {text}
        {streaming && <span className="streaming-cursor" />}
      </p>
    </section>
  );
};
