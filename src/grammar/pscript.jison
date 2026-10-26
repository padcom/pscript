/* PScript lexer and grammar (§4.1, §4.3).
 * Actions build nodes through the `yy` helpers installed by `src/parser/parse.ts`;
 * locations come from `@n` / `@$` (Jison yylloc) and are converted there.
 */

%lex

DIGITS          [0-9]+
EXPONENT        [eE][+-]?{DIGITS}
NUMBER          (({DIGITS}"."{DIGITS}?)|("."{DIGITS})|{DIGITS}){EXPONENT}?
IDENT           [A-Za-z_$][A-Za-z0-9_$]*

%%

[ \t\v\f\u00A0\uFEFF]+                         /* skip whitespace */
\r\n|[\n\r]                                     return 'NEWLINE'
[\u2028\u2029]                                  return yy.lineSeparator(this)
"//"[^\n\r\u2028\u2029]*                          /* skip line comment */
"/*"[\s\S]*?"*/"                                return yy.blockComment(yytext)
"/*"                                            yy.lexError("Unterminated comment", yylloc)

{NUMBER}                                        return yy.numberToken(yytext, yylloc, this._input)

\"([^"\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\"     return 'STRING'
\'([^'\\\r\n\u2028\u2029]|\\(\r\n|[\s\S]))*\'     return 'STRING'
["']                                            yy.lexError("Unterminated string", yylloc)

{IDENT}                                         return yy.identToken(yytext, yylloc)

"#"                                             yy.lexError("Unexpected '#'. Use the 'private' modifier for private members", yylloc)
"==="                                           yy.lexError("'===' is not supported; use '=='", yylloc)
"!=="                                           yy.lexError("'!==' is not supported; use '!='", yylloc)

"..."                                           return '...'
"?."                                            return '?.'
"=>"                                            return '=>'
"**="                                           return '**='
"&&="                                           return '&&='
"||="                                           return '||='
"??="                                           return '??='
"+="                                            return '+='
"-="                                            return '-='
"*="                                            return '*='
"/="                                            return '/='
"%="                                            return '%='
"**"                                            return '**'
"++"                                            return '++'
"--"                                            return '--'
"=="                                            return '=='
"!="                                            return '!='
"<="                                            return '<='
">="                                            return '>='
"&&"                                            return '&&'
"||"                                            return '||'
"??"                                            return '??'
"{"                                             return '{'
"}"                                             return '}'
"("                                             return '('
")"                                             return ')'
"["                                             return '['
"]"                                             return ']'
";"                                             return ';'
","                                             return ','
"."                                             return '.'
"?"                                             return '?'
":"                                             return ':'
"="                                             return '='
"+"                                             return '+'
"-"                                             return '-'
"*"                                             return '*'
"/"                                             return '/'
"%"                                             return '%'
"<"                                             return '<'
">"                                             return '>'
"!"                                             return '!'

<<EOF>>                                         return 'EOF'
.                                               yy.lexError("Unexpected character '" + yytext + "'", yylloc)

/lex

%start Program

%%

/* The token filter (src/parser/token-filter.ts) inserts the `;` that ASI requires (§4.2.1). */
Program
  : StatementList EOF
    { return yy.program($1) }
  ;

StatementList
  : /* empty */
    { $$ = [] }
  | StatementList Statement
    { $$ = $1.concat([$2]) }
  ;

Statement
  : VariableDeclaration ';'
  | Block
  | Expression ';'
    { $$ = yy.expressionStatement($1, @$) }
  | ';'
    { $$ = yy.emptyStatement(@$) }
  ;

Block
  : '{' StatementList '}'
    { $$ = yy.block($2, @$) }
  ;

VariableDeclaration
  : LET DeclaratorList
    { $$ = yy.variableDeclaration('let', $2, @$) }
  | CONST DeclaratorList
    { $$ = yy.variableDeclaration('const', $2, @$) }
  ;

DeclaratorList
  : Declarator
    { $$ = [$1] }
  | DeclaratorList ',' Declarator
    { $$ = $1.concat([$3]) }
  ;

Declarator
  : IDENT
    { $$ = yy.declarator(yy.identifier($1, @1), null, @$) }
  | IDENT '=' AssignmentExpression
    { $$ = yy.declarator(yy.identifier($1, @1), $3, @$) }
  ;

/* Expressions, lowest to highest precedence (§4.4.3). */

Expression
  : AssignmentExpression
  ;

/* The target is checked by yy.assignment (Identifier or, later, MemberExpression). */
AssignmentExpression
  : AdditiveExpression
  | CallExpression AssignmentOperator AssignmentExpression
    { $$ = yy.assignment($2, $1, $3, @$) }
  ;

AssignmentOperator
  : '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??='
  ;

AdditiveExpression
  : MultiplicativeExpression
  | AdditiveExpression '+' MultiplicativeExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | AdditiveExpression '-' MultiplicativeExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

MultiplicativeExpression
  : UnaryExpression
  | MultiplicativeExpression '*' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | MultiplicativeExpression '/' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  | MultiplicativeExpression '%' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

/* `-2 ** 2` is `-(2 ** 2)` (D15): a prefix operator applies to a whole exponentiation. */
UnaryExpression
  : ExponentiationExpression
  | '!' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | '-' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | '+' UnaryExpression
    { $$ = yy.unary($1, $2, @$) }
  | TYPEOF UnaryExpression
    { $$ = yy.unary('typeof', $2, @$) }
  ;

ExponentiationExpression
  : CallExpression
  | CallExpression '**' UnaryExpression
    { $$ = yy.binary($2, $1, $3, @$) }
  ;

CallExpression
  : PrimaryExpression
  | CallExpression Arguments
    { $$ = yy.call($1, $2, @$) }
  ;

Arguments
  : '(' ')'
    { $$ = [] }
  | '(' ArgumentList ')'
    { $$ = $2 }
  | '(' ArgumentList ',' ')'
    { $$ = $2 }
  ;

ArgumentList
  : Expression
    { $$ = [$1] }
  | ArgumentList ',' Expression
    { $$ = $1.concat([$3]) }
  ;

PrimaryExpression
  : NUMBER
    { $$ = yy.numberLiteral($1, @$) }
  | STRING
    { $$ = yy.stringLiteral($1, @$) }
  | TRUE
    { $$ = yy.literal(true, $1, @$) }
  | FALSE
    { $$ = yy.literal(false, $1, @$) }
  | NULL
    { $$ = yy.literal(null, $1, @$) }
  | UNDEFINED
    { $$ = yy.identifier($1, @$) }
  | IDENT
    { $$ = yy.identifier($1, @$) }
  | '(' Expression ')'
    { $$ = $2 }
  ;
