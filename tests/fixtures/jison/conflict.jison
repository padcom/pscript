/* Fixture grammar with an unresolved shift/reduce conflict (no precedence declarations). */

%lex
%%

\s+                   /* skip whitespace */
[0-9]+                return 'NUMBER'
"+"                   return '+'
<<EOF>>               return 'EOF'

/lex

%start program

%%

program
  : e EOF
  ;

e
  : e '+' e
  | NUMBER
  ;
