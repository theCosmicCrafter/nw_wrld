import { useSortable } from "@dnd-kit/sortable";

export const SortableWrapper = ({ id, disabled = false, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
  });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    zIndex: isDragging ? 999 : "auto",
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ 
        dragHandleProps: { ...attributes, ...listeners }, 
        isDragging 
      })}
    </div>
  );
};

