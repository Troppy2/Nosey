import { forwardRef } from "react";
import { Icon, type IconProps } from "./Icon";

// KojoCode topic: Hash Table. Keys pointing into value buckets. Not Lucide Hash (the # glyph).
export const HashTableIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <Icon ref={ref} name="hash-table" {...props}>
    <path d="M7 7.5H12M7 16.5H12" />
    <circle className="icon-fill" cx="5" cy="7.5" r="2" fill="currentColor" stroke="none" />
    <circle cx="5" cy="7.5" r="2" />
    <circle className="icon-fill" cx="5" cy="16.5" r="2" fill="currentColor" stroke="none" />
    <circle cx="5" cy="16.5" r="2" />
    <path className="icon-fill" d="M15 4.5H18Q21 4.5 21 7.5V7.5Q21 10.5 18 10.5H15Q12 10.5 12 7.5V7.5Q12 4.5 15 4.5Z" fill="currentColor" stroke="none" />
    <path d="M15 4.5H18Q21 4.5 21 7.5V7.5Q21 10.5 18 10.5H15Q12 10.5 12 7.5V7.5Q12 4.5 15 4.5Z" />
    <path className="icon-fill" d="M15 13.5H18Q21 13.5 21 16.5V16.5Q21 19.5 18 19.5H15Q12 19.5 12 16.5V16.5Q12 13.5 15 13.5Z" fill="currentColor" stroke="none" />
    <path d="M15 13.5H18Q21 13.5 21 16.5V16.5Q21 19.5 18 19.5H15Q12 19.5 12 16.5V16.5Q12 13.5 15 13.5Z" />
  </Icon>
));
HashTableIcon.displayName = "HashTableIcon";
