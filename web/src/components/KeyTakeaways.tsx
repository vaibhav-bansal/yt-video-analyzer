interface KeyTakeawaysProps {
  takeaways: string[];
}

export const KeyTakeaways = ({ takeaways }: KeyTakeawaysProps) => {
  return (
    <section className="section fade-in">
      <h3>Key Takeaways</h3>
      <ol className="takeaways-list">
        {takeaways.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </section>
  );
};
