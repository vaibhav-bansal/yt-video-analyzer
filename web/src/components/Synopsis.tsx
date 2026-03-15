interface SynopsisProps {
  text: string;
}

export const Synopsis = ({ text }: SynopsisProps) => {
  return (
    <section className="section fade-in">
      <h3>Synopsis</h3>
      <p className="synopsis-text">{text}</p>
    </section>
  );
};
