/* Fixture grammar for the Jison Vite plugin: a tiny calculator. */

%lex
%%

\s+                   /* skip whitespace */
[0-9]+("."[0-9]+)?    return 'NUMBER'
"*"                   return '*'
"/"                   return '/'
"-"                   return '-'
"+"                   return '+'
"("                   return '('
")"                   return ')'
<<EOF>>               return 'EOF'
.                     return 'INVALID'

/lex

%left '+' '-'
%left '*' '/'
%left UMINUS

%start program

%%

program
  : e EOF
    { return $1 }
  ;

e
  : e '+' e
    { $$ = $1 + $3 }
  | e '-' e
    { $$ = $1 - $3 }
  | e '*' e
    { $$ = $1 * $3 }
  | e '/' e
    { $$ = $1 / $3 }
  | '-' e %prec UMINUS
    { $$ = -$2 }
  | '(' e ')'
    { $$ = $2 }
  | NUMBER
    { $$ = Number(yytext) }
  ;
